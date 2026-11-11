---
name: gondola
description: Explore a UI or copy change as several finished variants built in parallel, then apply the one the user picks. Use when the user asks for options, alternatives, variations or "a few versions" of a page, section, component or its wording, or is unsure what a design should look like.
---

# Gondola: variants of a change, in parallel

`gondola explore` builds N variants of one change to this repo, each by a separate agent in its own Boat sandbox,
against the project's real dev server. It does not modify the working tree. Use it instead of designing one version
yourself when the user wants to choose between directions.

## When to use it

- The user asks for options, alternatives or variations of something visual or of its wording.
- The task is a self-contained piece of UI: a page, a section, a component.

Do not use it for backend work, bug fixes, or changes with one right answer. A run takes roughly 5 to 15 minutes and
uses the user's Boat compute and Claude plan, so start one only when the user asked for variants, and say how many
you are starting.

## Run it

1. Write the task as one clear sentence that names the page or component and the goal. Each agent receives exactly
   this sentence, so include any constraint the user gave.
2. Start the run in the background and wait for it to finish:

       gondola explore "<task>" -n 6 --path <route> --json

   - Add `--copy` if the wording should vary too (headlines, labels, calls to action). Facts stay fixed.
   - Add `--style wild` only if the user wants a different visual identity, not a variation within the current one.
   - In a monorepo add `--dir <app folder>`. If the app needs an ignored env file to start, add `--with <file>`
     after checking with the user, since that file is sent to the sandbox.
   - If it fails with "could not tell how to start the dev server" or "did not come up", pass `--dev`, `--install`
     and `--port` explicitly.
3. Read the JSON on stdout. For each finished variant it has `name`, `direction`, `summary`, `headline`,
   `changed`, `screenshot`, `patch`, and `apply`.

## Show the user

Give the path of `wall` (an HTML file that shows all variants side by side) and a short list: number, name,
one-line summary, and the headline if copy was varied. Look at the `screenshot` files yourself before recommending
one. Mention any variant with `issues_left` or a `page_status` that is not 200.

## Apply the choice

    gondola apply <n> --run <run id>        # into the working tree, uncommitted
    gondola apply <n> --run <run id> -b     # on a new branch gondola/<run>-<n>

Then run the project's checks, review the diff as you would your own change, and continue from there. If the user
wants parts of two variants, apply one and port the other's idea by hand using its `patch` as reference.

If a run is interrupted, `gondola clean` deletes any sandboxes it left running.
