import DialogTitle from "@mui/material/DialogTitle";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import DialogContentText from "@mui/material/DialogContentText";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import {
  AppBar,
  IconButton,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

type Props = {
  open: boolean;
  onSubmit: (formJson: { email: string }) => void;
  onClose: () => void;
};

const DialogComponent = ({ open, onSubmit, onClose }: Props) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <Dialog
      fullScreen={fullScreen}
      onClose={onClose}
      open={open}
      PaperProps={{
        component: "form",
        onSubmit: (event: any) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const formJson: any = Object.fromEntries(formData.entries());

          onSubmit(formJson);
          onClose();
        },
      }}
    >
      {fullScreen && (
        <AppBar sx={{ position: "relative" }}>
          <Toolbar>
            <IconButton
              edge="start"
              color="inherit"
              onClick={onClose}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              Inscreva-se
            </Typography>
            <Button type="submit" autoFocus color="inherit">
              Enviar
            </Button>
          </Toolbar>
        </AppBar>
      )}

      {!fullScreen && <DialogTitle>Inscreva-se</DialogTitle>}
      <DialogContent>
        <DialogContentText>
          Tenha acesso antecipado a plataforma e comece a automatizar a sua vida
          financeira em um click! Você será notificado quando a plataforma
          estiver no ar.
        </DialogContentText>
        <TextField
          autoFocus
          required
          margin="dense"
          id="name"
          name="email"
          label="Email"
          type="email"
          fullWidth
          variant="outlined"
        />
      </DialogContent>
      {!fullScreen && (
        <DialogActions>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit">Enviar</Button>
        </DialogActions>
      )}
    </Dialog>
  );
};

export default DialogComponent;
