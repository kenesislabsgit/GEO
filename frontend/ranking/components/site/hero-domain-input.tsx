"use client";

import { useEffect, useRef, useState } from "react";
import { stripUrlProtocolForInput } from "@/lib/strip-url-protocol";

function collapseCaret(input: HTMLInputElement) {
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

export function HeroDomainInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!input || !form) {
      return;
    }

    const dropHighlight = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (!target.closest("button, [type='submit']")) {
        return;
      }
      collapseCaret(input);
    };

    form.addEventListener("mousedown", dropHighlight);
    form.addEventListener("submit", dropHighlight);
    return () => {
      form.removeEventListener("mousedown", dropHighlight);
      form.removeEventListener("submit", dropHighlight);
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      name="domain"
      value={value}
      onChange={(event) => {
        const raw = event.target.value;
        const next = stripUrlProtocolForInput(raw);
        setValue(next);
        if (next !== raw) {
          requestAnimationFrame(() => collapseCaret(event.target));
        }
      }}
      onPaste={(event) => {
        const pasted = event.clipboardData.getData("text/plain");
        if (!/^(https?:\/\/)/i.test(pasted.trim())) {
          return;
        }
        event.preventDefault();
        const next = stripUrlProtocolForInput(pasted);
        setValue(next);
        requestAnimationFrame(() => collapseCaret(event.currentTarget));
      }}
      inputMode="url"
      autoComplete="url"
      spellCheck={false}
      placeholder="yourcompany.com"
      aria-label="Your website"
      className="h-full min-w-0 flex-1 select-text bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/35 selection:bg-transparent selection:text-foreground [-webkit-tap-highlight-color:transparent]"
    />
  );
}
