/**
 * TokenGate React Component
 * 
 * A reusable component that wraps content with token gate verification.
 * Uses the TokenGateVerifier to check access before rendering children.
 */

import React, { useEffect, useState, useCallback } from 'react';

// Types
export type AccessTier = 'none' | 'bronze' | 'silver' | 'gold';

export interface VerificationResult {
  passed: boolean;
  gateId: string;
  holder: string;
  timestamp: number;
  details: string[];
}

export interface TokenGateVerifier {
  verifyOwnership(gateId: string): Promise<VerificationResult>;
  checkStatus(gateId: string, address?: string): Promise<boolean>;
}

export interface TokenGateProps {
  /** The gate ID to check against */
  gateId: string;
  /** Verifier instance */
  verifier: TokenGateVerifier;
  /** Content to render when access is granted */
  children: React.ReactNode;
  /** Content to render when access is denied */
  fallback?: React.ReactNode;
  /** Content to render while verifying */
  loadingComponent?: React.ReactNode;
  /** Callback when verification completes */
  onVerified?: (result: VerificationResult) => void;
  /** Callback when verification fails */
  onDenied?: (error?: string) => void;
  /** If true, automatically attempt verification on mount */
  autoVerify?: boolean;
}

/**
 * TokenGate component that conditionally renders children based on
 * token ownership verification.
 */
export const TokenGate: React.FC<TokenGateProps> = ({
  gateId,
  verifier,
  children,
  fallback = <DefaultDeniedView />,
  loadingComponent = <DefaultLoadingView />,
  onVerified,
  onDenied,
  autoVerify = true,
}) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'granted' | 'denied'>('idle');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    setStatus('loading');
    setError(null);

    try {
      // Check if already verified (cached on-chain)
      const alreadyVerified = await verifier.checkStatus(gateId);
      if (alreadyVerified) {
        setStatus('granted');
        onVerified?.({
          passed: true,
          gateId,
          holder: '',
          timestamp: Date.now(),
          details: ['Previously verified'],
        });
        return;
      }

      // Attempt fresh verification
      const verificationResult = await verifier.verifyOwnership(gateId);
      setResult(verificationResult);

      if (verificationResult.passed) {
        setStatus('granted');
        onVerified?.(verificationResult);
      } else {
        setStatus('denied');
        onDenied?.('Verification failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setStatus('denied');
      onDenied?.(message);
    }
  }, [gateId, verifier, onVerified, onDenied]);

  useEffect(() => {
    if (autoVerify) {
      verify();
    }
  }, [autoVerify, verify]);

  // Render based on status
  switch (status) {
    case 'idle':
      return (
        <div className="token-gate idle">
          <button onClick={verify}>Verify Access</button>
        </div>
      );
    case 'loading':
      return <>{loadingComponent}</>;
    case 'granted':
      return <>{children}</>;
    case 'denied':
      return (
        <div className="token-gate denied">
          {fallback}
          {error && <p className="error">{error}</p>}
          {result?.details && (
            <ul className="details">
              {result.details.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
          <button onClick={verify}>Retry Verification</button>
        </div>
      );
    default:
      return null;
  }
};

/**
 * TieredTokenGate - Checks which access tier a user qualifies for
 * and renders the corresponding content.
 */
export interface TieredGateConfig {
  gateId: string;
  tier: AccessTier;
  content: React.ReactNode;
}

export interface TieredTokenGateProps {
  tiers: TieredGateConfig[];
  verifier: TokenGateVerifier;
  loadingComponent?: React.ReactNode;
  noAccessContent?: React.ReactNode;
}

export const TieredTokenGate: React.FC<TieredTokenGateProps> = ({
  tiers,
  verifier,
  loadingComponent = <DefaultLoadingView />,
  noAccessContent = <DefaultDeniedView />,
}) => {
  const [activeTier, setActiveTier] = useState<AccessTier | null>(null);
  const [loading, setLoading] = useState(true);

  const tierOrder: AccessTier[] = ['gold', 'silver', 'bronze', 'none'];

  useEffect(() => {
    const checkTiers = async () => {
      setLoading(true);

      // Sort tiers by priority (highest first)
      const sortedTiers = [...tiers].sort(
        (a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier)
      );

      for (const tier of sortedTiers) {
        try {
          const hasAccess = await verifier.checkStatus(tier.gateId);
          if (hasAccess) {
            setActiveTier(tier.tier);
            setLoading(false);
            return;
          }
        } catch {
          continue;
        }
      }

      setActiveTier(null);
      setLoading(false);
    };

    checkTiers();
  }, [tiers, verifier]);

  if (loading) return <>{loadingComponent}</>;
  if (!activeTier) return <>{noAccessContent}</>;

  const activeConfig = tiers.find((t) => t.tier === activeTier);
  return <>{activeConfig?.content ?? noAccessContent}</>;
};

/**
 * CompositeTokenGate - Requires multiple gates to be satisfied.
 */
export interface CompositeTokenGateProps {
  gateIds: string[];
  mode: 'all' | 'any';
  verifier: TokenGateVerifier;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  loadingComponent?: React.ReactNode;
}

export const CompositeTokenGate: React.FC<CompositeTokenGateProps> = ({
  gateIds,
  mode,
  verifier,
  children,
  fallback = <DefaultDeniedView />,
  loadingComponent = <DefaultLoadingView />,
}) => {
  const [loading, setLoading] = useState(true);
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    const checkAll = async () => {
      setLoading(true);
      const results = await Promise.all(
        gateIds.map((id) => verifier.checkStatus(id))
      );

      const hasAccess = mode === 'all'
        ? results.every(Boolean)
        : results.some(Boolean);

      setPassed(hasAccess);
      setLoading(false);
    };

    checkAll();
  }, [gateIds, mode, verifier]);

  if (loading) return <>{loadingComponent}</>;
  return <>{passed ? children : fallback}</>;
};

// Default UI components
function DefaultLoadingView() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p>🔐 Verifying token ownership...</p>
    </div>
  );
}

function DefaultDeniedView() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h3>🔒 Access Denied</h3>
      <p>You need the required tokens to access this content.</p>
    </div>
  );
}

export default TokenGate;
