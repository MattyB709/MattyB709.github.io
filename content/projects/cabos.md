---
slug: cabos
subtitle: A custom operating system built from scratch in Rust
title: CabOS
date: 2025-05-12
---


*This post is a work in progress! I'm currently working on getting the OS working on hardware (raspberry pi 4) and porting DOOM, plus finishing the writeup.*

TLDR: I worked with a group of ~8 people to build a multi-core OS kernel from scratch. The OS is portable across x86-64 and Aarch64 and uses Linux-style device interfaces with a device driver registration system that works across different discovery methods (device tree, acpi, pci). It has the full stack for loading user programs into memory and running them, including a VirtIO blk disk driver, Ext2 file system, page cache, and an ELF loader built on top of a virtual file system abstraction layer. It has a full process abstraction, including a process address space with demand paging, and supports running programs in user mode with proper syscall handling and returning. The kernel uses a simple round robin scheduler, and is itself is preemptible. 
