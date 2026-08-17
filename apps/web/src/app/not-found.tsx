export default function NotFound() {
  return (
    <div className="max-w-lg py-16">
      <h1 className="text-[24px] font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
        That page does not exist. If you followed a booking link, the booking may have been created
        against a database that has since been reset — the demo seeds hotels, not bookings.
      </p>
      <a
        href="/"
        className="mt-6 inline-block text-[13.5px] text-accent underline underline-offset-2"
      >
        Back to search
      </a>
    </div>
  );
}
