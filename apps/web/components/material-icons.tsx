// Google Material Symbols, inlined as SVG so there's no runtime font/CDN
// dependency ([DECISIONS #0043]). Paths are the official "outlined" weight on
// the Material Symbols 0 -960 960 960 viewBox. Add more here as the menu grows.

export interface IconProps {
  className?: string;
  size?: number;
}

function Icon({ className, size = 24, path }: IconProps & { path: string }) {
  return (
    <svg
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return <Icon {...props} path="M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z" />;
}

export function AccountIcon(props: IconProps) {
  return (
    <Icon
      {...props}
      path="M234-276q51-39 114-61.5T480-360q69 0 132 22.5T726-276q35-41 54.5-93T800-480q0-133-93.5-226.5T480-800q-133 0-226.5 93.5T160-480q0 59 19.5 111t54.5 93Zm246-164q-59 0-99.5-40.5T340-580q0-59 40.5-99.5T480-720q59 0 99.5 40.5T620-580q0 59-40.5 99.5T480-440Zm0 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q53 0 100-15.5t86-44.5q-39-29-86-44.5T480-280q-53 0-100 15.5T294-220q39 29 86 44.5T480-160Zm0-360Z"
    />
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon
      {...props}
      path="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
    />
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Icon
      {...props}
      path="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Z"
    />
  );
}

export function PlayIcon(props: IconProps) {
  return <Icon {...props} path="M320-200v-560l440 280-440 280Z" />;
}

export function JoinIcon(props: IconProps) {
  return (
    <Icon
      {...props}
      path="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-56-58 102-102H120v-80h326L344-622l56-58 200 200-200 200Z"
    />
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <Icon
      {...props}
      path="M280-80v-80h160v-124q-49-11-87.5-41.5T296-400q-83-10-139.5-72T100-620v-100q0-33 23.5-56.5T180-800h100v-80h400v80h100q33 0 56.5 23.5T860-720v100q0 86-56.5 148T664-400q-18 44-56.5 74.5T520-284v124h160v80H280Zm0-408v-232H180v100q0 53 28 91.5t72 40.5Zm200 128q50 0 85-35t35-85v-320H360v320q0 50 35 85t85 35Zm200-128q44-2 72-40.5t28-91.5v-100H680v232Z"
    />
  );
}
