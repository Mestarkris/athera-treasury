import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`${styles.button} ${styles[variant]} ${className ?? ""}`} {...rest} />;
}

export const buttonClass = (variant: ButtonVariant = "secondary") => `${styles.button} ${styles[variant]}`;
