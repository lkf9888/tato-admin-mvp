declare module "opencc-js" {
  type Locale = "cn" | "tw" | "twp" | "hk" | "jp" | "t";
  export function Converter(options: { from: Locale; to: Locale }): (text: string) => string;
}
