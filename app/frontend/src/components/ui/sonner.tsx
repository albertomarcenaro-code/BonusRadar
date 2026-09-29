import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={
        {
          "--normal-bg": "#FFFFFF",
          "--normal-text": "#111827",
          "--normal-border": "#E2E8F0",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
