import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThroughputEstimate } from './ThroughputEstimate';
import type { GpuThroughputEstimate } from '@airunway/shared';

const base: GpuThroughputEstimate = {
  perChatTokensPerSec: 40,
  concurrentSequences: 360,
  aggregateTokensPerSec: 14400,
  gpuModel: 'H100-80GB',
  perGpuMemoryGb: 80,
  memBandwidthGBs: 3350,
  tpSize: 4,
  contextLen: 4096,
  capacityLabel: '4x80 GB',
  lowConfidence: false,
};

describe('ThroughputEstimate', () => {
  it('shows both per-chat speed and concurrency when confident', () => {
    render(<ThroughputEstimate estimate={base} />);
    expect(screen.getByText(/~40 tok\/s per chat/)).toBeInTheDocument();
    expect(screen.getByText(/~360 concurrent/)).toBeInTheDocument();
    // Aggregate total (concurrency × per-chat rate) is shown in the visible label.
    expect(screen.getByText(/~14k tok\/s total/)).toBeInTheDocument();
  });

  it('shows only per-chat speed when low confidence', () => {
    render(
      <ThroughputEstimate
        estimate={{ ...base, lowConfidence: true, concurrentSequences: undefined, aggregateTokensPerSec: undefined }}
      />
    );
    expect(screen.getByText('~40 tok/s per chat')).toBeInTheDocument();
    expect(screen.queryByText(/concurrent/)).not.toBeInTheDocument();
  });

  it('shows a does-not-fit warning when the model has no room for KV cache', () => {
    render(
      <ThroughputEstimate
        estimate={{
          ...base,
          concurrentSequences: 0,
          aggregateTokensPerSec: 0,
          doesNotFit: true,
        }}
      />
    );
    expect(screen.getByText(/Does not fit/)).toBeInTheDocument();
    // The misleading per-chat / concurrency numbers must not be shown.
    expect(screen.queryByText(/tok\/s per chat/)).not.toBeInTheDocument();
    expect(screen.queryByText(/concurrent/)).not.toBeInTheDocument();
  });

  it('renders a loading state', () => {
    render(<ThroughputEstimate isLoading />);
    expect(screen.getByText(/Estimating speed/)).toBeInTheDocument();
  });

  it('renders nothing without an estimate', () => {
    const { container } = render(<ThroughputEstimate />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when per-chat speed is zero', () => {
    const { container } = render(
      <ThroughputEstimate estimate={{ ...base, perChatTokensPerSec: 0 }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
