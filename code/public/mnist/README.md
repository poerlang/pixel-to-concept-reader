# MNIST-derived data

This directory intentionally does **not** contain the dataset.

Place the following files here before running the code:

```text
mnist.json
mnist.bin
```

`mnist.bin` is raw unsigned 8-bit grayscale, row-major, 28×28 per image. `mnist.json` must include `size`, `total`, and `segments` with `digit`, `start`, and `count` for each class. See [../README.md](../README.md) for the exact format.

The original MNIST distribution has its own terms of use. This repository only documents the expected file format.
