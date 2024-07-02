import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

const CtaSection = () => (
  <Box
    display={'flex'}
    justifyContent={'space-between'}
    alignItems={{ xs: 'flex-start', sm: 'center' }}
    flexDirection={{ xs: 'column', sm: 'row' }}
  >
    <Box>
      <Typography fontWeight={700} variant={'h6'} gutterBottom>
        Registre-se hoje e garanta acesso antecipado a platforma.
      </Typography>
      <Typography>
        Você está a um passo de simplificar a sua vida financeira.
      </Typography>
    </Box>
    <Box
      component={Button}
      marginTop={{ xs: 2, sm: 0 }}
      variant="contained"
      size={'large'}
    >
      Inscreva-se agora
    </Box>
  </Box>
);

export default CtaSection;
