---
slug: cabos
subtitle: A custom operating system built from scratch in Rust
title: CabOS
date: 2026-08-02
---
[GitHub Link](https://github.com/MattyB709/CabOS)

*TL;DR*: I worked with a group of ~8 people to build a multi-core OS kernel from scratch. The OS is portable across x86-64 and Aarch64 and uses Linux-style device interfaces with a device driver registration system that works across different discovery methods (device tree, ACPI, PCI). It has the full stack for loading user programs into memory and running them, including a VirtIO disk driver, Ext2 file system, page cache, and an ELF loader. The kernel contains a virtual file system with support for mounting various filesystems and contains a /dev filesystem to expose devices to user programs through a Unix-style interface. It supports demand paging for processes and proper system-call handling. The kernel uses a simple round robin scheduler, and is itself preemptible. Most importantly, it can run DOOM. 
![DOOM](assets/images/doom.png "DOOM playing on CabOS")
## Building an Operating System

For the past ~7 months, I've worked on building an operating system from scratch. This started as a group project over the semester, and over the summer I completed most of the userspace support needed to run DOOM.  
### Supporting Multiple CPU Architectures

One of the most influential decisions made early on was supporting both the Aarch64 and x86-64 CPU architectures. In order to run our kernel on different architectures, we had to ensure no Aarch64 code is running on x86, and vice versa. We handled this by creating an `Arch` struct, our first layer of abstraction. Both Aarch64 and x86 have their own `Arch` struct that implement all functions in the `ArchTrait` trait, and the rest of the kernel just calls those functions without needing to know the underlying implementation. Here are a few examples: 

```rust
pub trait ArchTrait {
    /* ... */
    fn virtual_map(space: u64, vaddr: u64, paddr: u64, 
                   options: PagingOptions);
    fn virtual_unmap(space: u64, vaddr: u64) -> Option<u64>;
    fn get_phys_addr(vaddr: u64, space: u64) -> Option<u64>;
    fn irq_is_enabled() -> bool;
    fn shootdown_tlbs(space: u64, base: usize, length: usize);
    fn sleep_core();
   /* ... */
}
```

An example of how these are used is our kernel's implementation of [mmap](https://man7.org/linux/man-pages/man2/mmap.2.html), which we used to create mappings in the virtual address space of a process. For any process, we have a virtual memory subsystem that keeps track of what parts of their address space are mapped to physical memory. This code doesn't interact with the CPU architecture, but the process of actually mapping a virtual address to a physical address requires modifying page tables that must be read by the MMU, and every CPU architecture defines its own page table structure. Thus, we keep most of our `mmap` implementation architecture independent and call `Arch::virtual_map()` to create the mapping, not needing to know which CPU we are actually running on.
![arch](assets/images/arch_trait.png "Examples of kernel subsystems that interacted with the hardware through the shared Arch trait")
Supporting multiple architectures forced us to very clearly define what depended on the specific hardware and what did not. This led to a generally cleaner design of our kernel, but it was much more difficult. Everything CPU-specific had to be implemented twice, and I took ownership of most Aarch64 work, so I ended up doing a lot to match functionality with the x86 side, like page table handling,   [TLB](https://en.wikipedia.org/wiki/Translation_lookaside_buffer) maintenance, and saving execution state on scheduler preemption.

This actually was one of my favorite parts of the project; it forced me to work across a wide variety of kernel subsystems and learn more about what the hardware does and doesn't give software.

### Devices

One of the biggest surprises for me was how much of kernel development is dealing with devices[^devices]. Devices are tricky for many reasons. First is that the kernel must be flexible to whatever hardware it's on, meaning you want your OS to run whether your computer uses an SSD or an HDD for stable storage, yet the kernel does not know which one your computer will have when it is compiled. To allow this, you need a system for *device discovery*. The goal is this: after booting, figure out what devices are on your system, see if you have device drivers[^drivers] for them, and if so, match the driver with the device so the device can be controlled. Now, how does the OS know what devices are on the system at runtime?

There are a couple of ways[^pci]. First is the bootloader will give the kernel a pointer to a structure that provides information about the system, two big examples being [ACPI tables](https://uefi.org/htmlspecs/ACPI_Spec_6_4_html/01_Introduction/Introduction.html) and the [device tree](https://devicetree-specification.readthedocs.io/en/latest/chapter1-introduction.html). The trouble is these tend to be mutually exclusive, and our x86 people were using ACPI, while for Aarch64 we wanted to use device tree.[^device tree] Thus, we had to support each one. 
  
I'll explain device discovery from the perspective of the device tree as it is what I directly implemented, but a similar setup applies to discovery from an ACPI table or from PCI.
### Matching Hardware to Drivers
  
The device tree is a hierarchical set of nodes describing the system. Each node contains properties describing a specific piece of hardware, like the following node for UART PL011:
  ```
  pl011@9000000 {
      compatible = "arm,pl011", "arm,primecell";
      reg = <0x0 0x09000000 0x0 0x1000>;
      ...
      }
```

  
[UART](https://en.wikipedia.org/wiki/Universal_asynchronous_receiver-transmitter) PL011 was our kernel's choice for serial output on Aarch64, allowing `print!`[^std] to send text to [QEMU](https://www.qemu.org/), our chosen hardware emulator. The important part for discovery is the node is compatible with "arm,pl011". 
![devices](assets/images/devices.png "Overview of the device discovery system. Devices are classified as block devices, character devices, network devices, and other, and these categories determine how the kernel and userspace interact with them. Note that the networking stack and sockets are not fully implemented in CabOS, these boxes are left in for demonstration purposes.")
CabOS also maintains a list of all available system drivers. At startup we try to match each device node to a compatible driver. Conceptually: 
  ```rust
  for node in discovered_nodes {
    for driver in registered_drivers {
      if let Some(devices) = driver.am_i_this(node) {
        register(devices);
      }
    }
  }
  ```

To make this possible, each registered driver implements a common device discovery interface:
```Rust
trait DeviceDiscovery {
    // When a node matches, 
    // return all device handles it should contribute.
    fn am_i_this(&self, node: DeviceNode) -> Option<Vec<DeviceType>>;
    ...
```

Each driver reads the device node (an enum whose variants represent a device-tree node, an ACPI-discovered device, or a PCI function) to decide if it is compatible with the device, returning `None` if not. For the UART PL011 driver, it would read the compatible property of the device tree node, recognize `arm,pl011`, take in information such as the base register address, and return the instantiated UART device that can be used by the rest of the kernel.  

The important split here is separating discovering hardware from using hardware. ACPI, PCI, and the device tree all describe the system's hardware differently, but through a shared discovery interface the rest of the kernel does not need to know where the devices came from.  
## Running DOOM

Running DOOM became the capstone of this project because it tied much of the system's functionality into one working product. 

![DOOM Drawing](assets/images/doom_drawing.png "Different kernel subsystems DOOM was built on top of. Note that mmap interacts with the VFS as well, I left it pointing only at VM to simplify the diagram.")
DOOM is known for being highly portable, especially with the open source version [doom generic](https://github.com/ozkl/doomgeneric). In order to run it on a new system, 5 functions need to be implemented, the two most interesting being `DG_DrawFrame()` and `DG_GetKey()`, as these require interacting with a graphics framebuffer and keyboard respectively. Following the Unix philosophy that 'everything is a file', CabOS exposes devices through a file-like interface, meaning user programs largely interact with them through standard file functions like `read()`, `write()`, `open()`, `mmap()`, etc.[^ioctl] Just like Linux, all character and block devices are placed under a `/dev` filesystem. This means to get keyboard input the DOOM program simply calls `open()` on `/dev/event` and then `read()` to get input keys, and the kernel handles the rest. A similar process applies to writing pixels into a framebuffer exposed under `/dev/fb`, except instead of calling `write()` we call `mmap()` to create a mapping of the framebuffer in the process's address space and copy the pixels directly into the framebuffer. This direct mapping vastly reduces overhead because it removes the need for the process to make a syscall to write every line into the framebuffer; it can instead update the framebuffer using ordinary store operations without needing to switch to kernel mode. Once these functions are implemented, we compile it and link with a version of [mlibc](https://github.com/managarm/mlibc) ported to CabOS, giving the typical C standard library functions like `printf`.   

The above paragraph gives the userspace interface for a process, which is intentionally simple as the kernel abstracts away a lot of details. To see this, we can start with how the kernel loads the executable into memory. The executable starts living on a disk, in this case a VirtIO disk. [Ext2](https://en.wikipedia.org/wiki/Ext2) represents each file with an inode, a metadata structure that, among other things, identifies where the file’s data is stored on disk. The data can be read into memory from disk through the standard block device interface:

```rust
trait BlockDevice {
  
    fn read_blocks(
        &self,
        block_idxs: &[usize],
        buffers: &mut [&mut [u8]],
    ) -> Result<(), BlockDeviceError>;

    fn write_blocks(
      &self, 
      block_idxs: &[usize], 
      buffers: &[&[u8]])
    -> Result<(), BlockDeviceError>;
  
    /// more functions below
}
```

The block device interface is another example of separation of concerns: Ext2 doesn't care about the specific kind of disk it is running on, like VirtIO or SATA, it just needs to be able to read and write to it. On top of Ext2 sits the virtual file system (VFS). The VFS is how we allow user programs to treat everything like a file. Instead of keeping track of what's an inode and what's a device, the kernel passes around vnodes, or virtual nodes. The vnode is the standard interface for a file in the VFS.[^vnode] A process can call read() on a file descriptor without knowing what backs it. Inside the kernel, the VFS resolves that operation to a vnode, whose implementation dispatches the operation to Ext2, /dev, or another filesystem. This is how DOOM can read in bytes from a keyboard. 

The VFS is what we interact with to actually load the executable from a file on disk to a process in memory. Executables are compiled into the Executable and Linkable Format ([ELF](https://en.wikipedia.org/wiki/Executable_and_Linkable_Format)), and so we built an ELF loader to set up the process's address space. CabOS uses demand paging, meaning the ELF loader does not immediately copy every byte of the executable into physical memory. Instead, it records the virtual memory regions the process should have, and when the process first accesses a page that has not yet been loaded, the CPU raises a page fault. The kernel then determines which ELF segment the faulting address belongs to, reads the corresponding bytes from the executable through the VFS, maps a physical page at that virtual address, and resumes execution. From here, we set up the initial user stack following the Aarch64 System V ABI so the user program knows where to find `argc` and `argv`, and jump to executing in user mode at the ELF entry point. DOOM is then able to run normally, not needing to know the kernel subsystems it relies on.
## Reflections
### Working on a Large Scale Project

This was one of the first projects where I was directly collaborating with a large group of students without any direct supervision. At first I found it difficult to adjust to; I was really excited about this project and I wanted to do everything myself and understand every line of code. With time, though, I came to appreciate working in a bigger team than I was used to. We were able to get much more done together, although at times it was hard to tell who was working on what, and we didn't always agree what the most important next thing was. What helped me most to continue contributing here was working on my sense of *agency*. By this I mean reaching out to people directly to know what everyone was working on, reviewing as many PRs as I could, and making sure I understood the codebase in its entirety so I could best reason about what needed to be done next. This scratched my itch of learning as much as possible while not redoing work needlessly.

Another big thing was code design. To do it right, an operating system feels like something that needs to be done twice. The reason is it's hard to predict the future. The first time, you're learning about what the system needs as you go along, and what happened a lot was that we built something, it worked for the moment, but then failed to meet future needs. How could we have known about every future need, though? After reflection there's many things I would have designed differently if I wanted this to eventually become a production-ready kernel. 

### Why Systems Programming

This is a project I've been wanting to do since high school, ever since I started dual booting Ubuntu on my PC. I had no idea what I was really getting myself into. An operating system is a massive project. I've spent months working on it and have a lot of the core functionality done, and yet there are still many features missing, most notably running on hardware. I chose DOOM running stably as my end-goal for now so I could pick other projects back up, but in the future I may return to this. 

Between this project and becoming an OS TA, in this past year I've learned a lot about operating systems. It was only after I learned how an operating system worked that I really felt like I *understood* what was really happening on my computer. The operating system is one of the greatest feats of engineering in computer science because of the elegance of its abstractions. To write most programs, you don't need to understand CPU specifics, how your computer communicates with external devices, or even what other code is running on the machine. The operating system just handles this for you. This is amazing when you really think about it! And yet there is something incredibly satisfying about peeling back these layers of abstraction and knowing exactly what lies between your code and the hardware. There's always a bigger fish, though. The more I learn about systems the more I realize I have to learn. I've found this is a good problem to have, though. Thanks for reading!


[^devices]: A device is essentially anything a computer interacts with that is not the CPU or memory. Some examples are a GPU, SSD, network interface card, USB drive, keyboard, mouse, etc.  

[^drivers]: A device driver is software that handles communication with the underlying hardware. For example, a disk driver would be responsible for translating 'write these bytes to this section of the disk' to a request that the specific disk that is attached to the system actually understands. Every piece of hardware has its own protocol for interacting with it, making writing device drivers one of the most difficult parts of a good kernel. The amount of work needed to write a USB driver myself is a big reason I haven't gotten CabOS working on a Raspberry Pi yet. 

[^pci]: A method of device enumeration that I don't get into here but that our kernel supports is PCI enumeration. 

[^device tree]: Device tree and ACPI aren't exclusive to either CPU architecture, but this split happened because ACPI is much more common on x86 systems, and device tree is used for the Raspberry Pi (my original target hardware), which runs Aarch64.

[^std]: I think it's worth noting something that wasn't fully obvious to me before I started doing kernel work. Most programming languages define a standard library that includes standard utilities, like printing or dynamic memory allocation (think `malloc` in C or `new` in Java). These are all built on top of an operating system, for example `printf` in C calls `write()` under the hood, a system call where the OS handles transferring bytes to an external source, like the console. None of this exists when building the OS itself, meaning we needed to create our own method for sending characters to output. This also means one of the first steps in building an OS is building a heap allocator, that way in Rust we could use things like `Box` and `Arc` for dynamic allocations. 

[^ioctl]: A notable exception here is [ioctl](https://man7.org/linux/man-pages/man2/ioctl.2.html). Not all device needs can be captured using the standard file interface, for example checking the height and width of a framebuffer, so ioctl is used as the catch-all for any highly specialized requests user programs need to make to devices.

[^vnode]: The way this dynamic dispatch is done in Rust is through a [trait object](https://doc.rust-lang.org/book/ch18-02-trait-objects.html). Basically, anything that needs to be represented as a file implements the `VNode` trait. What we want then is to be able to store a bunch of objects that implement the vnode trait in a single data structure, and so we store `dyn VNode` objects instead (technically `Arc<dyn VNode>` to satisfy object sizing constraints), which hides the concrete type behind the trait interface. At runtime the correct function call is executed behind the trait interface, which is done through a [vtable](https://en.wikipedia.org/wiki/Virtual_method_table). Vtables are a bit beyond the scope of this post, but if you've ever used an object oriented programming language like Java, then you may have seen how if you do `Animal x = new Dog()` (assuming Dog extends Animal) then you call `x.speak()`, it calls Dog's `speak()` implementation instead of Animal's. This dynamic dispatch is usually implemented using vtables. 

