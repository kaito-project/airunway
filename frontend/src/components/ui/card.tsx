import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const cardVariants = cva(
  "rounded-2xl border text-card-foreground",
  {
    variants: {
      variant: {
        default: "overflow-hidden bg-white/[0.05] border-white/10 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_18px_40px_rgba(2,8,23,0.18)]",
        elevated: "overflow-hidden bg-white/[0.08] border-white/12 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_50px_rgba(2,8,23,0.22)]",
        outline: "bg-white/[0.02] border-white/10 backdrop-blur-lg shadow-none",
        glass: "overflow-hidden bg-white/[0.06] border-white/10 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_50px_rgba(2,8,23,0.20)]",
      },
      interactive: {
        true: [
          "transition-all duration-200 ease-out-expo cursor-pointer",
          "hover:-translate-y-0.5 hover:border-cyan-500/30 hover:shadow-glow-card",
          "active:translate-y-0 active:shadow-soft-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
        ],
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      interactive: false,
    },
  }
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, interactive }), className)}
      tabIndex={interactive ? 0 : undefined}
      {...props}
    />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
