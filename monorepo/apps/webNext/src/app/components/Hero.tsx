'use server'
import { Box, Button, Grid, Typography } from '@mui/material'
import styles from './Hero.module.css'
import CreditCardsIllustration from '../svg/CrediCards'

const Hero = () => {
  return (
    <Grid container spacing={4}>
      <Grid item xs={12} md={6}>
        <Box className={styles.heroBox}>
          <Box marginBottom={2}>
            <Typography
              variant='h2'
              component={'h2'}
              sx={{
                fontWeight: 700,
              }}
            >
              Automatize a sua vida financeira.
            </Typography>
          </Box>
          <Box marginBottom={3}>
            <Typography variant='h6' component='p' color='textSecondary'>
              A Wallex é uma plataforma que automatiza o gerenciamento das suas
              finanças pessoais, assim você pode ter tempo para focar no que
              realmente importa.
            </Typography>
          </Box>
          <Box
            display='flex'
            flexDirection={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'stretched', sm: 'flex-start' }}
          >
            <Box
              component={Button}
              variant='outlined'
              color='primary'
              size='large'
              // fullWidth={!isMd}
            >
              Saiba mais
            </Box>
            <Box
              component={Button}
              variant='contained'
              color='primary'
              size='large'
              // fullWidth={!isMd}
              marginTop={{ xs: 1, sm: 0 }}
              marginLeft={{ sm: 2 }}
            >
              Inscreva-se
            </Box>
          </Box>
        </Box>
      </Grid>
      <Grid item xs={12} md={6}>
        <Box
          className={styles.heroBox}
          height={'100%'}
          width={'100%'}
          display={'flex'}
          justifyContent={'center'}
          // data-aos={isMd ? 'fade-left' : 'fade-up'}
        >
          <Box
            height={'100%'}
            width={'100%'}
            maxWidth={{ xs: 500, md: '100%' }}
          >
            <CreditCardsIllustration width={'100%'} height={'100%'} />
          </Box>
        </Box>
      </Grid>
    </Grid>
  )
}

export default Hero
