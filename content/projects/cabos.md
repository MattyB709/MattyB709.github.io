---
slug: cabos
subtitle: A custom operating system built from scratch in Rust
title: CabOS
date: 2026-08-01
---

*TL;DR*: I worked with a group of ~8 people to build a multi-core OS kernel from scratch. The OS is portable across x86-64 and Aarch64 and uses Linux-style device interfaces with a device driver registration system that works across different discovery methods (device tree, acpi, pci). It has the full stack for loading user programs into memory and running them, including a VirtIO disk driver, Ext2 file system, page cache, and an ELF loader. The kernel contains a virtual file system with support for mounting various filesystems and contains a Linux style /dev filesystem to expose devices to user programs. It supports demand paging for processes and proper syscall handling. The kernel uses a simple round robin scheduler, and is itself is preemptible. Most importantly, it can run DOOM. 
![DOOM](assets/images/doom.png "DOOM playing on CabOS")
## Building an Operating System

For the past ~7 months, I've worked on building an operating system from scratch. This started as a group project over the semester, and over the summer I completed most of the userspace support needed to run DOOM to complete the rite of passage.  

During the last stretch of programming, I thought a lot about what this post would look like. There's a lot I could write about! I could try and break down major points of what an operating system is, the order things need to be built in and considerations, or talk about Unix systems, but there are probably better resources online for that. What I've decided on is to showcase some of my favorite parts of the system, explain what was needed to get DOOM to run, and describe the development experience and what I learned more generally.

### Supporting Multiple CPU Architectures

One of the most influential decisions made early on was the decision to support both the Aarch64 and x86-64 CPU architectures. For those unfamiliar, a CPU architecture defines what a CPU can do, including the instructions it can run, how it talks to memory, what registers it has to store data, etc. Any given program must be compiled for a specific CPU architecture. Most programs don't need to think about this, as it is handled by the compiler implicitly, liek running `cargo build` in Rust, but operating systems must interact directly with the hardware. In order to run our kernel on different architectures, we had to ensure no Aarch64 code is running on x86, and vice versa. We handled this by creating an `Arch` struct, our first layer of abstraction. Both Aarch64 and x86 implement all functions an the `ArchTrait` trait, and the rest of the kernel just calls those functions without needing to know the underlying implementation. Here are some examples of functions that are architecture specific: 

```rust
pub trait ArchTrait {
    /* ... */
    fn virtual_map(space: u64, vaddr: u64, paddr: u64, options: PagingOptions);
    fn virtual_unmap(space: u64, vaddr: u64) -> Option<u64>;
    fn get_phys_addr(vaddr: u64, space: u64) -> Option<u64>;
    fn irq_is_enabled() -> bool;
    fn sleep_core();
   /* ... */
}
```

An example of how these are used is our kernel's implementation of [mmap](https://man7.org/linux/man-pages/man2/mmap.2.html), which we used to create mappings in the virtual address space of a process. For any process, we have a virtual memory subsystem that keeps track of what parts of their address space are mapped to physical memory. This code doesn't interact with the CPU architecture, but the process of actually mapping a virtual address to a physical address requires modifying page tables that must be read by the MMU, and every CPU architecture defines its own page table structure. Thus, we keep most of our `mmap` implementation architecture independent and call `Arch::virtual_map()` to create the mapping, not needing to know which CPU we are actually running on.

TODO explain `Arch` in more detail.

Suppporting multiple architectures forced us to very clearly define what depended on the specific hardware and what did not. This led to a generally cleaner design of our kernel, but it was much more difficult. Everything CPU specific had to be implemented twice, and I was one of the few people who cared about Aarch64 support, so I ended up doing a lot of work to keep up with the x86 side:

![aarch64 | 500](assets/images/aarch64.png "My PR's implementing Aarch64 support across most of the kernel. The tests relied on shutdown, which is why CI failed for my eariler PR's")
This actually ended up being a great learning experience. I got to work across a wide variety of systems in the kernel, and I learned a lot of low-level hardware details, like TLB cache coherency. 

### Devices


One of the biggest surprises for me was how much of kernel development is dealing with devices[^devices]. In a typical OS class, the focus is on the core topics, like concurrency, virtual memory, filesystems, etc. About [60%](https://en.wikipedia.org/wiki/Linux_kernel#:~:text=while%2060%25%20is%20drivers) of the Linux kernel is device drivers, though! 

Devices are tricky for many reasons. First is that the kernel must be flexible to whatever hardware it's on, meaning you want your OS to run whether your computer uses an SSD or an HDD, yet the kernel does not know which one your computer will have when it is compiled. To allow this, you need a system for *device discovery*. The goal is this: after booting, figure out what devices are on your system, see if you have device drivers[^drivers] for them, and if so, match the driver with the device so the device can be controlled. Now, how does the OS know what devices are on the system at runtime?

There are a couple of ways[^pci]. First is the bootloader will give the kernel a pointer to a structure that provides information about the system, the two biggest examples being [ACPI tables](https://uefi.org/htmlspecs/ACPI_Spec_6_4_html/01_Introduction/Introduction.html) and the [device tree](https://devicetree-specification.readthedocs.io/en/latest/chapter1-introduction.html). The trouble is these are mutually exclusive, and our x86 people were using ACPI, while for Aarch64 we wanted to use device tree.[^device tree] Thus, we had to support each one. Just like CPU architectures, supporting multiple mutually exclusive systems was challenging but resulted in better overall design decisions. 

I'll first go over our discovery system at a high level first, and then walk through a concrete example with a specific device: UART.

### Device Discovery

I'll explain device discovery from the perspective of the device tree because it is a bit simpler and it is what I worked on the most, but a similar setup applies to discovery from an ACPI table. The device tree organizes devices in a hierarchical set of no
At kernel startup, we parse the device tree. The device tree is arranged as a hierarchical set of nodes, where each node typically describes a specific device or property about the hardware. Every node has a list of properties, the most important one being the `compatible` property, which is a string that acts as a unique identifier for the piece of hardware. For every device node in the device tree, we pass it in to each of our device drivers. Each driver uses the compatible string to check if it can control the hardware, and if so, it instantiates the device to be used by the rest of the kernel. Below is a concrete example with UART. 

A Universal Asynchronous Receive-Transmit (UART) device provides a method for sending bytes through a serial connection to a receiver using the UART protocol. It's often used in low-level systems work because it is simple and allows for transmission of bytes to an external source. In our case it allowed us to send bytes from our kernel to [QEMU](https://www.qemu.org/)[^Qemu], which is how we implemented `print!` for debugging.[^std]

I will describe the discovery system from the perspective of device tree because that is what I directly implemented, but a similar process applies to doing device discovery from an ACPI table or PCI. Every device needs a device discovery trait:
```Rust
pub trait DeviceDiscovery {
    // When a node matches, 
    // return all device handles it should contribute.
    fn am_i_this(&self, node: DeviceNode) -> Option<Vec<DeviceType>>;
    ...
```

The function `am_i_this` takes in a DeviceNode, which is an enum over types of Nodes, for this example a device tree node.  


, like the following for UART PL011: 
```
  pl011@9000000 {
      compatible = "arm,pl011", "arm,primecell";
      reg = <0x0 0x09000000 0x0 0x1000>;
      ...
      }
```


## Reflections
### Working on a Large Scale Project

This is the first project I've worked on where I relied on other people a lot. Perhaps embarassingly, it was the first time I ever made a PR! At first I found it difficult to adjust to; I was really excited about this project and I wanted to do everything myself, understand every line of code. With time, though, I came to appreciate working in a bigger team than I was used to. With proper communication we were able to achieve a lot more through continuous discussion and division of responsibility, although getting to that stage was easier said than done. We were all programmers, not project managers, we just cared about building the thing. It was hard to tell who was working on what, and we didn't always agree what the most important next thing was. What helped me most to continue contributing here was working on my sense of *agency*. By this I mean reaching out to people directly to know what everyone was working on (this felt difficult when I barely knew these people but got easier with time), reviewing as many PR's as I could, and making sure I understood the codebase in its entirety so I could best reason about what needed to be done next. This helped scratch my itch of learning as much as possible while not redoing work needlessly.

Another big thing was code design. To do it right, an operating system is really something that needs to be done twice. The reason is it's hard to predict the future. The first time, you're learning about what the system needs as you go along, and what happened a lot was that we built something, it worked for the moment, but then failed to meet future needs. How could we have known about every future need, though? After reflection there's many things I would have designed differently if I wanted this to eventually become a production-ready kernel. 

### The Joys of Systems Programming

This is a project I've been wanting to do since high school, ever since I started dual booting Ubuntu on my PC. I had no idea what I was really getting myself into. An operating system is something of an infinite project. I've spent months working on it and have a lot of the core functionality done, and yet there are still many features missing[^missing], most notably running on hardware. I chose DOOM running stably as my end-goal for now so I could pick other projects back up, but in the future I may return to this. 

Between this project and becoming an OS TA, in this past year I've learned a lot about operating systems. It was only after I learned how an operating system worked that I really felt like I *understood* what was really happening on my computer. The operating system is one of the greatest feats of engineering in computer science because of the elegance of its abstractions. To write most programs, you don't need to understand CPU specifics, how your computer communicates with external devices, or even what other code is running on the machine. The operating system just handles this for you. This is amazing when you really think about it! And yet there is something incredibly satisfying about peeling back these layers of abstraction and knowing exactly what lies between your code and the hardware. There's always a bigger fish, though. The more I've learned about hardware, the more I've realized how much I have left to learn! 


[^devices]: A device is essentially anything a computer interacts with that is not the CPU or memory. Some examples are a GPU, SSD, network interface card, USB drive, keyboard, mouse, etc.  

[^drivers]: A device driver is software that handles communication with the underlying hardware. For example, a disk driver would be responsible for translating 'write these bytes to this section of the disk' to a request that the specific disk that is attached to the system actually understands. Every piece of hardware has its own protocol for interacting with it, making writing device drivers one of the most difficult parts of a good kernel. The amount of work needed to write a USB driver myself is a big reason I haven't gotten CabOS working on a Raspberry Pi yet. 

[^pci]: A method of device enumeration that I don't get into here but that our kernel supports is PCI enumeration. 

[^device tree]: Device tree and ACPI aren't exclusive to either CPU architecture, but this split happened because ACPI is much more common on x86 systems, and device tree is used for the Raspberry Pi (my target hardware), which uses Aarch64.

[^Qemu]: Qemu is a hardware emulator, meaning it essentially pretends to be hardware that our kernel can run on. An emulator is an essential tool for kernel development
[^std]: I think it's worth noting something that may not be fully obvious to someone who hasn't done any kernel work. Most programming languages define a standard library that includes standard utilities, like printing or dynamic memory allocation (think `malloc` in C or `new` in Java). These are all built on top of an operating system, for example `printf` in C calls `write()` under the hood, a system call where the OS handles transferring bytes to an external source, like the console. None of this exists when building the OS itself, meaning we needed to create our own method for sending characters to output. This also means one of the first steps in building an OS is building a heap allocator, that way in Rust we could use things like `Box` and `Arc` for dynamic allocations. 

[^missing]: Some embarassing examples of missing features are page eviction and cleaning up resources of a dead process. These are things I have implemented before, and I decided to focus my time on other features instead to be able to move on to other projects I'm interested in
