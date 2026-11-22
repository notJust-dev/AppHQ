/** A dash for a number nobody reported, which is not the same as zero; said as "No data". */
export function NoData() {
  return (
    <>
      <span aria-hidden="true">–</span>
      <span className="sr-only">No data</span>
    </>
  )
}
