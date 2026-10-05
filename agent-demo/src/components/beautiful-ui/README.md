# Beautiful UI adaptations

Source: https://github.com/slev12397/beautiful-ui (MIT, copyright 2026 Shane Levine).

`PromptBar.tsx` adapts the original `components/primitives/PromptBar.tsx`: rounded
composer, expanding textarea, model control, and send button. The chat bubble and
reply styles in `src/App.tsx` follow `ChatComposer.tsx`; the semantic Tailwind
colors and shadows in `src/styles.css` adapt the original foundation.

The gallery's simulated replies, attachments, dictation, and shader effects are
omitted. The model picker uses Radix Popover for focus and dismissal and is wired
to Monitor's saved providers and the live OpenRouter model catalog. Messages,
streaming, tools, approvals, and permissions remain connected to Convex.

The original license is preserved in `LICENSE`.
