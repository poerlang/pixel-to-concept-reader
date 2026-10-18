# Code snapshot

This directory contains the code used for the paper in the repository root.

It is a small TypeScript project with **no runtime npm dependencies**. It needs Node.js 26 (or a Node version with native TypeScript type stripping).

## What is here

```text
src/nars/         generic NAL terms, truth values, memory, rules, revision
src/perception/   pixel-to-candidate and structural-term extraction
src/view/         HTML report and memory-tower views
tools/baby.ts     train / test / shift / trace / tower commands
tools/classic.ts  classic-figure diagnostics
tools/curriculum.ts
tools/translation.ts
tools/layout.ts
docs/curriculum.json
```

The separation is intentional: `src/nars` contains generic inference code; `src/perception` contains the domain-specific transducer. The paper’s experiments use the latter; the former has no digit- or image-specific names.

## Data

The MNIST-derived binary is **not included** in this repository. Put these two files in `public/mnist/`:

```text
public/mnist/
  mnist.json
  mnist.bin
```

`mnist.bin` is a raw sequence of unsigned 8-bit grayscale pixels, row-major, 28×28 per image. `mnist.json` describes the segments:

```json
{
  "size": 28,
  "bytesPerImage": 784,
  "total": 9761,
  "segments": [
    { "digit": 0, "start": 0, "count": 1001 }
  ]
}
```

`start` is the global image index; `count` is the number of images in that digit segment. The code uses the first 80 images of each class for training, and images at offsets 200–219 for the 200 test samples.

The original MNIST dataset is available from its official distribution. Follow its terms when preparing `mnist.bin`.

## Run

```bash
cd code
npm run train     # structural terms → memory/nars.json + memory/terms.json
npm run test      # 200 test images: NAL accuracy + public/test/ report
npm run shift     # translation probe
npm run trace     # one image: loops, shifts, terms, NAL answer
npm run tower     # memory/tower.html
```

Diagnostics:

```bash
npm run classic
npm run curriculum
npm run translation
npm run layout
```

The reported result is **81.0% (162/200)** on the 200-image test set. The code does not use a classifier, kNN, a decision tree, or template matching; comparison, revision, and questioning are done in NAL.

## Scope

This is a research snapshot, not a production library. The paper reports the method and its limits; the code is included so the claims can be inspected and rerun.

Paper and PDFs: [../paper/](../paper/)  
Zenodo record: <https://doi.org/10.5281/zenodo.23461123>
