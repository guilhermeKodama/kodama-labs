import Divider from '@mui/material/Divider'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import { Topbar, Sidebar, Footer } from './components'
import Container from '../../../common/Container'
import { pages } from '../navigation'

type Props = {
  children: React.ReactNode
}

const Main = ({ children }: Props) => {
  return (
    <div>
      <Box>
        <AppBar
          position={'fixed'}
          sx={{
            backgroundColor: '#161c23',
          }}
          elevation={1}
        >
          <Container paddingY={{ xs: 1 / 2, sm: 2 }}>
            <Topbar />
          </Container>
        </AppBar>
      </Box>
      <Sidebar open={false} variant='temporary' pages={pages} />
      <Box
        component='main'
        sx={{
          backgroundColor: '#161c23',
        }}
      >
        <Box height={{ xs: 56, sm: 64 }} />
        {children}
        <Divider />
      </Box>
      <Container paddingY={4}>
        <Footer />
      </Container>
    </div>
  )
}

export default Main
