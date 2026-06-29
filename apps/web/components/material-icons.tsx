// Google Material Symbols, inlined as SVG so there's no runtime font/CDN
// dependency ([DECISIONS #0043]). Paths use the Material Symbols 0 -960 960 960
// viewBox. Add more here as the menu grows.

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
      path="M280-320h80v-80h-80v80Zm160 0h80v-80h-80v80Zm160 0h80v-80h-80v80ZM280-480h80v-80h-80v80Zm160 0h80v-80h-80v80Zm160 0h80v-80h-80v80ZM200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Z"
    />
  );
}

export function PlayIcon(props: IconProps) {
  const { className, size = 24 } = props;
  return (
    <svg
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80ZM400-320v-320l240 160-240 160Z"
      />
    </svg>
  );
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
      path="M280-80v-80h160v-124q-83-14-141.5-72.5T226-500q-54-9-90-50t-36-94v-76q0-33 23.5-56.5T180-800h100v-80h400v80h100q33 0 56.5 23.5T860-720v76q0 53-36 94t-90 50q-14 84-72.5 142.5T520-284v124h160v80H280Zm0-504v-136H180v76q0 33 28.5 58.5T280-584Zm400 0q43-7 71.5-32.5T780-644v-76H680v136Z"
    />
  );
}

export function ShareIcon(props: IconProps) {
  return <IosShareIcon {...props} />;
}

export function IosShareIcon(props: IconProps) {
  return (
    <Icon
      {...props}
      path="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h120v80H240v400h480v-400H600v-80h120q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm200-240v-447l-64 64-56-57 160-160 160 160-56 57-64-64v447h-80Z"
    />
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Icon
      {...props}
      path="M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z"
    />
  );
}

export function ExpandMoreIcon(props: IconProps) {
  return <Icon {...props} path="M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z" />;
}
