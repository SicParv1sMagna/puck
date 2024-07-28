import { useEffect, useState } from "react";

const styles = `
/* Prevent user from interacting with underlying component */
[data-puck-component] * {
  user-select: none;
}

[data-puck-component] {
  cursor: grab;
  pointer-events: auto !important;
}

[data-dnd-placeholder] {
  background: var(--puck-color-azure-06) !important;
  border: none !important;
  color: #00000000 !important;
  opacity: 0.3 !important;
  outline: none !important;
  transition: none !important;
}

[data-dnd-placeholder] *, [data-dnd-placeholder]::after, [data-dnd-placeholder]::before {
  opacity: 0 !important;
}

[data-dnd-dragging] {
  pointer-events: none !important;
}
`;

export const useInjectStyleSheet = (initialStyles: string) => {
  const [el] = useState<HTMLStyleElement>(document.createElement("style"));

  useEffect(() => {
    el.innerHTML = initialStyles;
    document.head.appendChild(el);
  }, []);

  return el;
};

export const useInjectGlobalCss = () => {
  return useInjectStyleSheet(styles);
};
