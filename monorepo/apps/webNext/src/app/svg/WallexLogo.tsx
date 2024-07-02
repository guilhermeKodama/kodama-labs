type Props = {
  width?: number | string
  height?: number | string
}

const Wallex = ({ width = 45, height = 70 }: Props) => {
  const colorPrimaryMain = '#4caf50'
  const colorPrimaryDark = '#4caf50'
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={width}
      height={height}
      fill='none'
      viewBox='0 0 95 71'
      transform='rotate(180)'
    >
      <rect
        width='16.811'
        height='68.926'
        x='0.664'
        y='7.769'
        fill={colorPrimaryMain}
        stroke={colorPrimaryDark}
        rx='8.406'
        transform='rotate(-25 .664 7.77)'
      ></rect>
      <rect
        width='16.811'
        height='68.926'
        x='28.665'
        y='7.769'
        fill={colorPrimaryMain}
        stroke={colorPrimaryDark}
        rx='8.406'
        transform='rotate(-25 28.665 7.77)'
      ></rect>
      <rect
        width='16.811'
        height='16.81'
        x='78.769'
        y='0.664'
        fill={colorPrimaryMain}
        stroke={colorPrimaryDark}
        rx='8.405'
        transform='rotate(25 78.77 .664)'
      ></rect>
    </svg>
  )
}

export default Wallex
