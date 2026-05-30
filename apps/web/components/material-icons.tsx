// Google Material Symbols, inlined as SVG so there's no runtime font/CDN
// dependency ([DECISIONS #0043]). Paths are the official "outlined" weight on
// the Material Symbols 0 -960 960 960 viewBox. Add more here as the menu grows.

interface IconProps {
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
