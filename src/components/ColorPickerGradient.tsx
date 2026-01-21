import React from "react";
import ColorPicker from "react-best-gradient-color-picker";
import { formatHex, parse } from "culori";

type ColorPickerGradientProps = {
  value: string;
  onChange: (value: string) => void;
  idSuffix?: string;
};

const extractFirstColor = (value: string) => {
  if (!/gradient/i.test(value)) return value;
  const match = value.match(/(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
  return match ? match[1] : value;
};

const toHex = (value: string) => {
  const parsed = parse(value);
  return parsed ? formatHex(parsed).toUpperCase() : value.toUpperCase();
};

const ColorPickerGradient: React.FC<ColorPickerGradientProps> = ({ value, onChange, idSuffix }) => (
  <ColorPicker
    value={value}
    onChange={(next) => {
      const solid = extractFirstColor(next);
      onChange(toHex(solid));
    }}
    width={240}
    height={160}
    hideInputs={false}
    hideOpacity
    hideHue={false}
    hideControls
    hideColorTypeBtns
    hidePresets
    hideEyeDrop
    hideColorGuide
    hideInputType
    hideGradientType
    hideGradientAngle
    hideGradientStop
    hideGradientControls
    disableDarkMode={false}
    disableLightMode
    idSuffix={idSuffix}
  />
);

export default ColorPickerGradient;
