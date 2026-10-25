---
id: l50                       # unique across the whole package, stable forever
title: "Lab 1: build the thing"   # titles starting with Lab, Capstone, Exercise or Workshop must list resources
quiz: quiz-50.yaml            # optional
resources: [../resources/lab1-run.py, ../resources/lab1-requirements.txt]   # runnable files you ran yourself
sources: [1]
---
After this lab you will have run <the thing> on your own machine and seen <the concrete result>.

## Shortcut: the ready-made files

Download the files from this lesson's Resources. They need no internet access and were run while writing this course.

```bash
uv venv && uv pip install -r lab1-requirements.txt   # pin any version that broke in testing
python lab1-run.py
```

What you should see: <the exact number, file or message from your own test run>. If yours differs a little, <say how much is normal and why>.

## Step 1: what the script does

Explain the script in short steps, so the learner understands each part and could type it themselves. [1]

## Check yourself

- A question that needs the learner to look at their own output.
- A change to try (a different setting) and what to expect.

:::low-confidence
State anything you could not run or verify here (for example a step that needs a GPU or an account). Do not claim files were tested if they were not.
:::

:::key-takeaways
- One-line takeaway.
:::

:::glossary
- **Term**: its plain meaning in one everyday sentence.
:::
