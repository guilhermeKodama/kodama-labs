import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TableAlign = "left" | "center" | "right";
export type TableRowTone = "success" | "danger" | "warning" | "info" | "neutral";

const ALIGN: Record<TableAlign, string> = { left: "text-left", center: "text-center", right: "text-right" };
const TONE_DOT: Record<TableRowTone, string> = {
  success: "bg-pos",
  danger: "bg-neg-solid",
  warning: "bg-warn-solid",
  info: "bg-cat-blue",
  neutral: "bg-fg-3",
};

/**
 * The mockup's simple table (pivot, settings lists, previews): 32px header
 * in 11.5px tertiary, 36px rows split by hairlines, optional totals footer.
 * For the ledger itself use the virtualized table, not this.
 */
export function Table({
  headers,
  rows,
  columnAlign,
  rowTone,
  footer,
  framed = true,
  striped,
  stickyHeader,
  emptyMessage,
  onRowClick,
  isSelected,
  rowKey,
  className,
}: {
  headers: ReactNode[];
  rows: ReactNode[][];
  columnAlign?: (TableAlign | undefined)[];
  /** A small colored dot before the first cell of each row. */
  rowTone?: (TableRowTone | undefined)[];
  /** Totals row, same columns as `headers`. */
  footer?: ReactNode[];
  framed?: boolean;
  striped?: boolean;
  stickyHeader?: boolean;
  emptyMessage?: ReactNode;
  onRowClick?: (index: number) => void;
  isSelected?: (index: number) => boolean;
  rowKey?: (index: number) => string;
  className?: string;
}) {
  const align = (column: number) => ALIGN[columnAlign?.[column] ?? "left"];
  const table = (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr className="h-8">
          {headers.map((header, column) => (
            <th
              key={column}
              scope="col"
              className={cn("px-3 text-[11.5px] font-normal whitespace-nowrap text-fg-3", align(column), stickyHeader && "sticky top-0 z-[1] bg-editor")}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, index) => {
          const tone = rowTone?.[index];
          return (
            <tr
              key={rowKey ? rowKey(index) : index}
              onClick={onRowClick ? () => onRowClick(index) : undefined}
              aria-selected={isSelected ? isSelected(index) : undefined}
              className={cn(
                "h-9 border-t border-stroke-3",
                striped && index % 2 === 1 && "bg-fill-4",
                onRowClick && "cursor-pointer hover:bg-fill-4",
                isSelected?.(index) && "bg-fill-3 hover:bg-fill-3",
              )}
            >
              {cells.map((cell, column) => (
                <td key={column} className={cn("px-3", align(column))}>
                  {column === 0 && tone ? <span className={cn("mr-2 inline-block size-1.5 rounded-full align-middle", TONE_DOT[tone])} /> : null}
                  {cell}
                </td>
              ))}
            </tr>
          );
        })}
        {rows.length === 0 && emptyMessage ? (
          <tr className="border-t border-stroke-3">
            <td colSpan={headers.length} className="px-3 py-6 text-center text-[12px] text-fg-3">
              {emptyMessage}
            </td>
          </tr>
        ) : null}
      </tbody>
      {footer ? (
        <tfoot>
          <tr className="h-9 border-t border-stroke-2 bg-fill-4 font-semibold">
            {footer.map((cell, column) => (
              <td key={column} className={cn("px-3", align(column))}>
                {cell}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
  if (!framed) return <div className={cn("min-w-0", className)}>{table}</div>;
  return <div className={cn("min-w-0 overflow-auto rounded-[8px] border border-stroke-3", className)}>{table}</div>;
}
