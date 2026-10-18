# Operation Differences and Relative Layout: A NAL-Based Structural-Term Recognition Experiment

**Ketai Mo**

## A reader's guide

For readers from other fields, the central question is:

> Getting the digit right is the result; the paper asks whether the reasons for that answer can be written as inspectable relations.

An everyday analogy: when you see a handwritten “8”, you remember “one loop above, one below, narrow in the middle,” without memorizing every pixel. For “9” you remember “one loop above, one tail below.” This paper lets a computer take that route: first group bright dots into patches, then record how the patches step and turn, what repeats, where a path closes, and how they sit relative to one another, and finally compare these relations with remembered digits. These relations are called “terms” in the system—think of them as checkable statements. NAL (Non-Axiomatic Logic) attaches a degree of confidence to each judgment; new evidence can revise it.

| Reader | Suggested starting point |
|---|---|
| Curious middle-school / non-specialist | this guide, Figure 1, Section 4.2, Section 6 |
| Philosophy / psychology | this guide, Section 1, Section 5.1, Section 5.4 |
| Education | this guide, the example in Section 3.2, Section 5.4 |
| Technical | the whole paper |

## Abstract

This paper reports a handwritten digit recognition experiment. The system stores no pixel templates; it groups bright pixels into rough circular patches, records how these patches step and turn, what repeats, where a path closes, and how patches sit relative to one another, and then compares these relations with remembered digits. Recognition is done by NAL (Non-Axiomatic Logic, a logic that allows uncertain and revisable judgments); no standard classifier (a model that maps an image directly to a label) is used. It reaches 81.0% on 200 test images; relative positions remain unchanged under translation on a classic figure. We also report confusions between 8 and 9 and the current bottleneck, and position this as an independent engineering experiment, not a new theory of NAL vision.

**Keywords:** non-axiomatic reasoning; NARS; structural terms; operation difference; relative layout; visual recognition

![Figure 1: Top, the usual “answer only” path; bottom, this paper’s “state the relations” path](assets/overview-en.png)

## 1. Introduction

Handwritten digit recognition is commonly formulated as a mapping from pixels to labels. Deep models achieve high accuracy, but their internal representations and decision evidence are often hard to interpret. For general intelligence research, the more important question is “can recognition be built on reusable, reasonable concepts?”; a higher percentage is not the goal here.

Existing NAL vision research provides an important reference: one line of work builds a concept network from edge/curve concepts, explains observations by abduction, and updates prototypes by induction [9]. This paper shares the premise that vision can be part of NAL. It studies **operation differences, accumulated rotation, constancy, closure, and relative layout**, rather than an edge/curve prototype library. It does not propose a new theory of NAL vision; it is an independent engineering experiment.

Against that background, this paper studies a smaller but testable question: **can a set of structural terms replace pixel features and let NAL inference perform recognition?** “Structural” here means reusable relations such as roughly circular local patches, one step between adjacent patches, the difference between consecutive steps, accumulated rotation, repeated patterns, closure, and relative positions; it does not involve fitting strokes into vector graphics or replacing pixels with convolutional features. A patch is a small region made of several nearby bright pixels, not a single pixel, and not necessarily a real circle or a concept. For readability, we call such a roughly circular local patch a loop and one step between two patches a Shift; readers unfamiliar with these names may read them as “local patch” and “one step between patches.”

A concrete example: for “8”, the system stores “one closed loop above, one below, narrowed between them,” not “the pixel at row i, column j is black.” For “9”, it stores “one loop above, one open tail below.” These relations can be stated in ordinary language and checked.

A common description of this work—“moving from pixel recognition to vector recognition”—is imprecise. The system does not perform SVG curve fitting or geometric template matching, and pixels are not discarded. A more accurate description is:

```text
pixels → structural relations → terms → NAL inference → answer
```

Pixels are only the input to a perception channel. What enters memory and inference is structural relations. The contributions are:

1. a structural vocabulary centered on operation differences, accumulation, constancy, closure, and relative layout, distinct from edge/curve visual prototypes;
2. `∩` compounds for wholes such as “ring + blank center,” with NAL-3 introduction and elimination;
3. an evaluation of a classifier-free, NAL-only recognition path on 200 handwritten digits;
4. an analysis of failures showing that the single-observation/term-bag design is the current bottleneck.

## 2. Related Work

### 2.1 NARS and perception

Pei Wang’s NARS is built around **adaptation under insufficient knowledge and resources** (AIKR): reasoning under uncertainty and incomplete experience rather than fitting a fixed classifier [1]. NARS perception research treats sensory input as part of the same experience-and-inference framework; perception is not a separate vision module followed by classification. Related work describes sensorimotor channels, event buffers, and a two-way process of bottom-up compression and top-down anticipation [2–5].

The OpenNARS/ONA community has built event buffers and sensorimotor mechanisms into runnable systems; NARS-Python provides a perception testbed [6–8]. These works provide the framework; this paper does not implement the full NARS perception architecture.

### 2.2 A closely related NAL vision line

Reference [9], *Vision by Logic: A Naïve Visual Recognition Model with Non-axiomatic Logic*, is one representative of this line. It treats an “object” as the sum of relative positions of its parts, builds a concept network from edge/curve concepts, models recognition as abduction that explains an observation with a known prototype, and models learning as induction that updates prototypes.

### 2.3 Two different trade-offs

| Dimension | Prior line [9] | This work |
|---|---|---|
| Visual unit | edges, curves, object prototypes | roughly circular patches, operation differences, accumulation, constancy, closure, relative layout |
| Recognition | explain observation with a prototype (abduction) | compare and revise class terms |
| Learning | induction updates visual prototypes | class-internal term frequencies |
| Goal | a unified NAL vision model | an independent structural-term experiment and failure analysis |

Both share the premise that vision can be part of NAL, but their units and recognition paths differ: the prior line explains observations with visual prototypes, while this work compares class terms formed from operation differences and relative layout. The two trade-offs can be complementary; this paper reports another structural vocabulary on the same handwritten-digit task, with its own boundaries.
## 3. Method

### 3.1 Perception channel and reasoning layers

The system has two layers.

The **perception channel** converts 16×16 pixels into initial region proposals: `growDiscs` grows roughly circular patches (loops) from active pixels; one step between two loops is a Shift. Geometry is allowed here, but it only proposes regions; it does not decide the digit.

The **reasoning layer** sees only structural terms. A class concept in memory is represented as:

```text
digit_d → [term_1, term_2, ...]
```

Each term carries a frequency `f` and a confidence `c`. At recognition time the current frame is also represented as `frame → [terms]`; NAL comparison and revision produce `frame ↔ digit_d`, and the answer is the class with the highest expectation. There is no softmax, kNN, decision tree, or template matching.

### 3.2 Structural terms

The vocabulary has five groups:

- **loop**: number, size, fill, and chain length of roughly circular patches;
- **Shift**: one step between adjacent loops, with start, direction, and step length;
- **operation difference**: direction/step difference between consecutive Shifts, split into `big/small_shift_diff_*` by relative receptive-field area;
- **accumulation and constancy**: accumulated rotation `shift_diff_accum_*`; repeated same-direction, similar-step `const_low/high`; `closure` when a chain comes back to its start;
- **relative layout**: a loop’s cell in the 4×4 object frame, and pairwise direction, distance, size ratio, and overlap.

In everyday language:

| Term | Plain meaning |
|---|---|
| loop | a rough circular patch |
| Shift | one step from patch A to patch B |
| operation difference | how much the direction or step length changes between two consecutive steps |
| accumulated rotation | all the turning added up; four quarter-rotations make roughly one full turn |
| constancy | several consecutive steps keep a similar direction and length |
| closure | the path comes back to where it started |
| relative layout | where a patch sits and how far it is, relative to the whole, not in absolute coordinates |

For example, `shift_diff_accum_l_4` means about four quarter-rotations, i.e., roughly one full rotation. `big_shift_diff_r_1` means a larger-area rightward operation difference with step ratio in bucket 1. These are relational terms, not pixel coordinates.

### 3.3 `∩` compounds and wholes

“Ring ∩ blank center” is not a new atom. It is an NAL-3 intersection:

```text
∩([shift_diff_accum_*], [center_blank], [const_low/high])
```

`center_blank` is only a component of the compound term. It is not a standalone class term, and there is no flood-fill or hole-detection algorithm. The core also implements intersection introduction and elimination:

```text
M → T1, M → T2  ⇒  M → (T1 ∩ T2)
(A ∩ B) → A,  (A ∩ B) → B
```

Thus “ring + blank center” can be constructed from component observations and decomposed for checking, rather than hard-coded as a label in the perception layer.

### 3.4 Relative layout

Layout terms do not store absolute coordinates. They store relations relative to the object frame or receptive field:

```text
this loop is in the upper-left of the object frame
this loop is to the right of another loop
the two loops are a few radii apart
```

If the object translates while its internal relations stay the same, layout terms should stay the same. Section 4 tests this.

## 4. Experiments

### 4.1 Setup

We use 16×16 handwritten digits: 80 training and 20 test images per class, 200 test images in total. The structural vocabulary is collected from the training set. Recognition uses only NAL comparison, revision, and questioning; no pixel features or classifier are used at that stage.

### 4.2 Results

| Metric | Result |
|---|---|
| Test accuracy | **81.0% (162/200)** |
| Structural terms | 226 types / 2260 beliefs |
| Memory size | 455.0 KB JSON / 199.3 KB binary |
| Translation (1,0)/(0,1)/(1,1)/(2,2) | 80.0 / 79.0 / 78.0 / 75.5% |
| Training / test time | 0.5 s / 3.7 s |

Figure 2 shows the classic figures used as a curriculum. A pure circle is mainly accumulated full rotation; a straight line has no accumulation; an angle has a quarter rotation; an S-curve has fragmented accumulation; an 8 has multiple accumulation directions and two blank centers; a 9 is one closure plus a quarter rotation and an open tail. These are not training classes; they are interpretable references for structural terms.

![Figure 2: Classic figures as a curriculum](assets/classic-figures-vertical.png)

Figure 3 reports the layout test: after shifting a classic 9 by 0/1/2 cells, all 43 layout terms remain identical. Absolute coordinates would change; relative relations do not.

![Figure 3: Relative layout is invariant under translation](assets/layout-invariance-vertical.png)

### 4.3 Failure analysis

The prototype still makes clear errors. Confusion between 8 and 9 is typical: on sample #8040, the report already shows a chain-level partition with two closed blocks, yet the classifier outputs 9. Additional experiments show that adding “double ring,” “weak-edge ring,” or “number of closed blocks” as new terms directly into the term bag reduces accuracy to around 80%.

The reason is not a missing feature. The current recognizer accepts only **one term bag**: partition/whole explanations do not enter class comparison as independent observations. A merge mechanism for multiple observation sets exists, but subsets cut from the same global term bag cannot produce genuinely different explanations. This is the main limitation and the starting point for future work.

## 5. Discussion

### 5.1 Difference from prior NAL vision and vector recognition

Compared with the visual-prototype line in [9], both use NAL and neither trains an end-to-end classifier, but their units differ: that line explains observations with edge/curve visual prototypes, while this work forms class terms from operation differences, accumulation, constancy, closure, and relative layout. This paper does not reuse that visual prototype library, nor does it introduce “circle/edge” as new atomic concepts. It is therefore an independent test of another structural vocabulary, not a replacement for or refutation of that line.

The method is also not vector-graphic recognition. Vector methods usually fit strokes into curves/polygons and match geometric parameters; this work keeps structural relations and lets NAL perform recognition. A more appropriate name is **structural-term recognition**: terms are reusable relations, not coordinates or templates.

For readers outside AI, the 81.0% is only a result; the value lies in an inspectable middle layer: for philosophy, it operationalizes “meaning” as relations and evidence without claiming to equal human semantics; for psychology, it offers an externally checkable hypothesis rather than a brain model; for education, it separates “why this answer” into discussable steps and can serve as classroom material. These are possible implications, not conclusions tested here.

### 5.2 Contributions relative to that route

1. **Memory stores structural terms, not edge/curve prototypes**: loops, Shifts, operation differences, constancy, closure, and layout; the class side stores only “digit → term” frequencies.
2. **Recognition uses NAL comparison/revision**: no softmax/kNN/tree, and no visual-prototype abduction.
3. **Operation differences become first-class relations**: a circle is accumulated rotation, not template matching; constancy is a repeated operation pattern.
4. **`∩` compounds carry sameness/wholes**: “ring ∩ blank center” is constructed and decomposed in NAL-3, not a “hole” label.
5. **An AIKR, small-data route with failure analysis**: 80 images per class; reports 8-versus-9 confusions and the single-observation bottleneck rather than only successes.

### 5.3 Four common misunderstandings

- **Is this deep learning?** No. There is no neural network and no trained classifier; recognition is done by NAL comparison, revision, and questioning.
- **Does it turn images into vectors?** No. There is no curve fitting or geometric template matching; what remains is relational terms.
- **Is this a model of the human brain?** No. It is an engineering analogy, not a claim to copy the visual cortex or human concepts.
- **Is 81.0% competitive?** The paper does not aim at state-of-the-art MNIST accuracy; it tests whether “structural terms + NAL” can run and where it fails.

### 5.4 Limitations

- input is only 16×16, and the structural vocabulary is hand-designed;
- 81.0% is not state of the art on MNIST and does not prove general vision;
- a full event buffer, top-down anticipation, and an active-perception loop are not yet implemented;
- Confusions such as 8 versus 9 still occur; the single-observation/term-bag design is a located bottleneck;
- “concept” here is an operational structural term, not a human concept.

## 6. Conclusion

This paper presented a runnable experiment: pixels are converted into initial loop/Shift proposals by a perception channel; operation differences, accumulation, constancy, closure, and relative layout are written as terms; NAL performs recognition. It reaches 81.0% on 200 handwritten digits, with layout terms invariant under translation. The result shows that a “structural terms + NAL inference” path can run, but the 8-versus-9 confusions also show that a single observation/term bag cannot carry multiple partition explanations. Relative to that visual-prototype route, this paper tests a different vocabulary centered on operation differences and relative layout; the next step is to let different partitions generate genuinely different observation sets and let NAL evidence compete, rather than adding more special terms to the same bag.

## References

1. Pei Wang. *Non-Axiomatic Reasoning System: Exploring the Essence of Intelligence*. [PhilPapers](https://api.philpapers.org/rec/WANNRS)
2. Pei Wang. *Perception in NARS* (PAGI-TR-7). [PDF](https://cis.temple.edu/tagit/publications/PAGI-TR-7.pdf)
3. Pei Wang. *Sensorimotor in NARS* (PAGI-TR-8). [PDF](https://cis.temple.edu/tagit/publications/PAGI-TR-8.pdf)
4. Pei Wang, Patrick Hammer. *Perception from an AGI Perspective*. [PDF](https://cis.temple.edu/~pwang/Publication/perception.pdf)
5. *The Event Buffer of OpenNARS* (TAGIT-TR-22). [PDF](https://cis.temple.edu/tagit/publications/TAGIT-TR-22.pdf)
6. *A Model of Unified Perception and Cognition*. Frontiers in Artificial Intelligence, 2022. [Full text](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2022.806403/full)
7. *NARS-Python v0.3 — Technical Overview*. [PDF](https://cis.temple.edu/tagit/events/workshop2021/NARS_files/docs/NARSPythonv0.3.pdf)
8. Pei Wang. Selected papers. [Web](https://cis.temple.edu/~pwang/papers.html)
9. B. Xu, B. Xu, P. Wang. *Vision by Logic: A Naïve Visual Recognition Model with Non-axiomatic Logic*. AGI 2026, LNCS 16855. [DOI](https://doi.org/10.1007/978-3-032-33195-3_30)
