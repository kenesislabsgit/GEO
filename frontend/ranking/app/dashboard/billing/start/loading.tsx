export default function CheckoutStartLoading() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm font-medium">Taking you to checkout…</p>
      <p className="text-sm text-muted-foreground">This only takes a moment.</p>
    </div>
  );
}
