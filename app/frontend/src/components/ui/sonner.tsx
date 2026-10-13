import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          "--normal-bg": "#0e1729",
          "--normal-text": "#e9f0fa",
          "--normal-border": "rgba(255, 255, 255, 0.12)",
          "--success-bg": "#0e1729",
          "--success-text": "#34d399",
          "--error-bg": "#0e1729",
          "--error-text": "#fb7185",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
