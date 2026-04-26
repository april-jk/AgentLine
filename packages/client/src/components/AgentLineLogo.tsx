/**
 * AgentLineLogo - Brand logo component with dark/light mode support.
 */

interface AgentLineLogoProps {
  /** Show compact version (icon + text) vs just text */
  showIcon?: boolean;
  /** Additional className for styling */
  className?: string;
}

export function AgentLineLogo({
  showIcon = true,
  className = "",
}: AgentLineLogoProps) {
  return (
    <span className={`agentline-logo ${className}`}>
      {showIcon && (
        <img
          src="/icon-192.png?v=agentline-image2"
          className="agentline-logo-icon"
          alt=""
          aria-hidden="true"
        />
      )}
      <span className="agentline-logo-text">
        <span className="agentline-logo-primary">Agent</span>
        <span className="agentline-logo-secondary">Line</span>
      </span>
    </span>
  );
}
