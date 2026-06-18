type FrustrationDetectionState = {
  state: 'closed'
  handleTranscriptSelect: (...args: unknown[]) => void
}

export function useFrustrationDetection(): FrustrationDetectionState {
  return {
    state: 'closed',
    handleTranscriptSelect: () => {},
  }
}
