import { TableCell, TableRow, Typography } from '@mui/material';

// ----------------------------------------------------------------------

type Props = {
  notFound: boolean;
};

export function TableNoData({ notFound }: Props) {
  return (
    <TableRow>
      {notFound ? (
        <TableCell colSpan={12}>
          <Typography variant="h6" align="center">
            Nenhum investimento encontrado
          </Typography>
        </TableCell>
      ) : (
        <TableCell colSpan={12} sx={{ p: 0 }} />
      )}
    </TableRow>
  );
} 