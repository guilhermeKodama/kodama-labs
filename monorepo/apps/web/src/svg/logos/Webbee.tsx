import React from "react";
import { useTheme } from "@mui/material/styles";

type Props = {
  width?: string | number;
  height?: string | number;
};

const Webbee = ({ width = 45, height = 70 }: Props) => {
  const theme = useTheme();
  const colorPrimaryMain = theme.palette.primary.main;
  const colorPrimaryDark = theme.palette.primary.main;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      fill="none"
      viewBox="0 0 95 71"
    >
      <rect
        width="16.811"
        height="68.926"
        x="0.664"
        y="7.769"
        fill={colorPrimaryMain}
        stroke={colorPrimaryDark}
        rx="8.406"
        transform="rotate(-25 .664 7.77)"
      ></rect>
      <rect
        width="16.811"
        height="68.926"
        x="28.665"
        y="7.769"
        fill={colorPrimaryMain}
        stroke={colorPrimaryDark}
        rx="8.406"
        transform="rotate(-25 28.665 7.77)"
      ></rect>
      <rect
        width="16.811"
        height="16.81"
        x="78.769"
        y="0.664"
        fill={colorPrimaryMain}
        stroke={colorPrimaryDark}
        rx="8.405"
        transform="rotate(25 78.77 .664)"
      ></rect>
    </svg>
  );
};

export default Webbee;
