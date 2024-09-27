import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { useState } from 'react';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  content: string;
  onClose: () => void;
  onCancel: () => void;
  onConfirm: (text: string) => void;
};
export function FormDialog({ open, content, onClose, onCancel, onConfirm }: Props) {
  const [text, setText] = useState('');
  return (
    <div>
      <Dialog open={open} onClose={onClose}>
        <DialogTitle>Digite a senha do PDF</DialogTitle>

        <DialogContent>
          <Typography sx={{ mb: 3 }}>{content}</Typography>

          <TextField
            autoFocus
            fullWidth
            type="text"
            margin="dense"
            variant="outlined"
            label="Password"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </DialogContent>

        <DialogActions>
          <Button onClick={onCancel} variant="outlined" color="inherit">
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(text)} variant="contained">
            Enviar
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
