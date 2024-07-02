import React from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import IconButton from '@mui/material/IconButton'
import MenuIcon from '@mui/icons-material/Menu'
import WallexLogo from '../../../../svg/WallexLogo'

const Topbar = (
  {
    // themeMode,
    // themeToggler,
    // onSidebarOpen,
  }
) => {
  return (
    <Box
      display={'flex'}
      justifyContent={'space-between'}
      alignItems={'center'}
      width={'100%'}
    >
      <Box display={'flex'} alignItems={'center'}>
        <Box marginRight={{ xs: 1, sm: 2 }}>
          <IconButton aria-label='Menu'>
            <MenuIcon />
          </IconButton>
        </Box>
        <Box
          display={'flex'}
          alignItems='baseline'
          component='a'
          href='/'
          title='webbee'
          height={{ xs: 28, md: 32 }}
          width={45}
        >
          <WallexLogo height={'100%'} width={'100%'} />
        </Box>
      </Box>
      <Box display='flex' alignItems={'center'}>
        <Box>
          {
            <svg
              width={24}
              height={24}
              xmlns='http://www.w3.org/2000/svg'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'
              />
            </svg>
          }
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'flex' } }} alignItems={'center'}>
          <Box>
            <Link underline='none' component='a' href='/' color='textPrimary'>
              Home
            </Link>
          </Box>
          <Box marginX={2}>
            <Link
              underline='none'
              component='a'
              href='/docs-introduction'
              color='textPrimary'
            >
              Documentation
            </Link>
          </Box>
          <Box>
            <Button
              variant='contained'
              color='primary'
              component='a'
              target='blank'
              href='https://material-ui.com/store/items/webbee-landing-page/'
              size='large'
            >
              Purchase now
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default Topbar
