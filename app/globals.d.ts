import "react";

declare module "*.css";
declare module "*.css?url" {
  const href: string;
  export default href;
}
declare module "jsbarcode" {
  function JsBarcode(
    element: unknown,
    data: string,
    options?: Record<string, unknown>,
  ): void;
  export default JsBarcode;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
