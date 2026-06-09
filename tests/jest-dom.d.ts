// Augment bun:test with jest-dom matchers so toBeInTheDocument() etc type-check.
// The @testing-library/jest-dom package does not export a "bun" subpath, so we
// manually replicate what its types/bun.d.ts would do.
import type { expect } from "bun:test";
import type { matchers as TLMatchers } from "@testing-library/jest-dom/matchers";

type JestDomMatchers<E, R> = {
  toBeInTheDocument(): R;
  toBeVisible(): R;
  toBeDisabled(): R;
  toBeEnabled(): R;
  toBeChecked(): R;
  toBeEmptyDOMElement(): R;
  toHaveAttribute(attr: string, value?: string): R;
  toHaveClass(...classNames: string[]): R;
  toHaveFocus(): R;
  toHaveFormValues(values: Record<string, unknown>): R;
  toHaveStyle(css: string | Record<string, unknown>): R;
  toHaveTextContent(text: string | RegExp, options?: { normalizeWhitespace: boolean }): R;
  toHaveValue(value?: string | string[] | number | null): R;
  toHaveDisplayValue(value: string | RegExp | Array<string | RegExp>): R;
  toBeRequired(): R;
  toBePartiallyChecked(): R;
  toHaveDescription(text?: string | RegExp): R;
  toBeInvalid(): R;
  toBeValid(): R;
  toContainElement(element: HTMLElement | SVGElement | null): R;
  toContainHTML(html: string): R;
  toHaveAccessibleDescription(text?: string | RegExp): R;
  toHaveAccessibleName(text?: string | RegExp): R;
  toHaveErrorMessage(text?: string | RegExp): R;
};

declare module "bun:test" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends JestDomMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
