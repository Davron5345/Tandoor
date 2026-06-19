import { IconNavBranch } from './NavIcons';

export default function BranchChip({ children, className = 'page-subtitle' }) {
  return (
    <span className={`ui-chip${className ? ` ${className}` : ''}`}>
      <IconNavBranch />
      <span>{children}</span>
    </span>
  );
}
