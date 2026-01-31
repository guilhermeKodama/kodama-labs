import { TableHead, TableRow, TableCell, TableSortLabel } from '@mui/material';

// ----------------------------------------------------------------------

type Props = {
  order: 'asc' | 'desc';
  orderBy: string;
  headLabel: {
    id: string;
    label: string;
    width?: number;
    minWidth?: number;
  }[];
  onSort: (id: string) => void;
};

export default function InvestmentsTableHead({ order, orderBy, headLabel, onSort }: Props) {
  return (
    <TableHead>
      <TableRow>
        {headLabel.map((headCell) => (
          <TableCell
            key={headCell.id}
            sortDirection={orderBy === headCell.id ? order : false}
            sx={{ width: headCell.width, minWidth: headCell.minWidth }}
          >
            <TableSortLabel
              hideSortIcon
              active={orderBy === headCell.id}
              direction={orderBy === headCell.id ? order : 'asc'}
              onClick={() => onSort(headCell.id)}
            >
              {headCell.label}
            </TableSortLabel>
          </TableCell>
        ))}
      </TableRow>
    </TableHead>
  );
} 