import DialogTitle from "@mui/material/DialogTitle";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import DialogContentText from "@mui/material/DialogContentText";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";

type Props = {
  open: boolean;
  onSubmit: (formJson: Record<string, string>) => void;
};

const DialogComponent = ({ open, onSubmit }: Props) => {
  const handleClose = () => {};

  return (
    <Dialog
      onClose={handleClose}
      open={open}
      PaperProps={{
        component: "form",
        onSubmit: (event: any) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const formJson: any = Object.fromEntries(formData.entries());

          onSubmit(formJson);
          handleClose();
        },
      }}
    >
      <DialogTitle>Sua opinião é importante</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Quais são seus maiores desafios como vendedor do Mercado Livre?
        </DialogContentText>
        <TextField
          autoFocus
          required
          margin="dense"
          id="name"
          name="suggestion"
          label="Sugestão"
          type="text"
          fullWidth
          variant="outlined"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancelar</Button>
        <Button type="submit">Enviar</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DialogComponent;
