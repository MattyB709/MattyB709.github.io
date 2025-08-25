---
slug: numpy
title: Numpy is All You Need
subtitle: I implemented a neural network from scratch in Numpy. 
date: 2025-04-03 
---

TLDR: I spent the last 2 days implementing and training a neural network from scratch in Numpy. I used 
an MLP architecture with 3 layers, ReLU activations, and cross entropy loss trained on torchvision's
MNIST dataset. After ~10 min of training I got >97% accuracy on the test set, which I was satisfied with

Code: [https://github.com/MattyB709/numpyNN](https://github.com/MattyB709/numpyNN)

# Implementing a neural network in Numpy

This is a project I've been wanting to work on ever since I read through the backpropagation chapter of 
[Understanding Deep Learning](https://udlbook.github.io/udlbook/) (still the best resource on ML I've
read). Every neural network I've trained has been in PyTorch, so I wanted to see if I could implement it
start to finish on my own, without following any tutorials. I'll give a brief summary of each section below. 

### Feedforward network and design choices

Making an MLP to train on MNIST was an easy choice for a Numpy neural network, this has become the hello
world of neural network training, so it seemed fitting. The actual MLP layers are quite easy to code, 
they're just matrix multiplications with an added vector bias. In the final architecture, I ended up with 3 linear layers and 2 ReLU functions, which seemed to work out fine, so I never changed it. The actual code style
is quite similar to PyTorch, with `forward()` and `backward()` methods in each layer, and a `parameters()` method
to pass in parameters and their calculated gradients into my Adam optimizer. 

### Gradient calculation and optimization

Implementing backpropagation was the real heart of the project because it's what I understood least. 
At a high level, backprop is quite easy to understand, it's just an application of the chain rule to multiple 
layers. I had no idea how these gradients were actually calculated or passed back through the network. The most useful resource for me here was some [Stanford lecture notes](https://web.stanford.edu/class/cs224n/readings/gradient-notes.pdf) that went over how gradients worked for linear layers, ReLU functions, and cross entropy loss (exactly what I needed)! By reading this and carefully testing the shape of my calculated gradients, I was able to make the correct. From there, I also decided to implement the Adam optimizer, which is the only optimizer that I've ever used for training. Here is where I encountered my first real bug, that had to do with references! The way my optimizer works is it receives a list of all parameters and their respective gradients in the form [(params_1, grads_1), (params_2, grads_2) ...]. The way I did this was by concatenating references to each layer's parameters and gradients (self.weights, self.weights_grad were attributes of the model struct) into a list and passing that into the optimizer. Normally this would be completely fine, because in PyTorch, gradients for each layer are added (this is important because actual gradients can come from different sources, like a skip connection in a transformer. This is also why you have to do `optimizer.zero_grad()` in PyTorch, but not in my implementation), but in my implementation I decided to just set the gradients directly in the struct after they were calculated, like this:
```self.weights_grad = self.x.T @ delta```.
This may not seem like a big issue, but instead of changing the parameters of the gradients that the optimizer had access to, it was just overwriting the reference in self.weights_grad to a completely different reference, meaning the gradients the optimizer had access to never were updated! This meant that the gradients the optimizer saw were just always zero, resulting in no change to the parameters, and no improvement in training. This is probably the first time I've ever had to think about references in Python, so I'm glad I was able to learn one useful thing from Java. The fix was simple, I used numpy slicing to edit the gradient array in place: 
```self.weights_grad[:] = self.x.T @ delta```.
With this, everything was fixed, and after about 10 minutes of training (25 epochs) I got performance I was satisfied with. Onto more RL projects. 