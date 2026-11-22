/**
 * A dash for a number nobody reported, which is not the same as zero; said as "No data", or as
 * `label` where the dash means something else, such as an empty slot.
 */
export function NoData({ label = 'No data' }: { label?: string }) {
  return (
    <>
      <span aria-hidden="true">–</span>
      <span className="sr-only">{label}</span>
    </>
  )
}
