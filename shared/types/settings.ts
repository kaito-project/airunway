/**
 * Settings and Provider types
 */

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  defaultNamespace: string;
}

export interface CRDConfig {
  apiGroup: string;
  apiVersion: string;
  plural: string;
  kind: string;
}

export interface InstallationStep {
  title: string;
  command?: string;
  description: string;
}

export interface HelmRepo {
  name: string;
  url: string;
}

export interface HelmChart {
  name: string;
  chart: string;
  version?: string;
  namespace: string;
  createNamespace?: boolean;
  values?: Record<string, unknown>;
}

export interface ProviderDetails extends ProviderInfo {
  crdConfig: CRDConfig;
  installationSteps: InstallationStep[];
  helmRepos: HelmRepo[];
  helmCharts: HelmChart[];
}

export interface AppConfig {
  /** @deprecated No longer used - each deployment specifies its own provider */
  activeProviderId?: string;
  defaultNamespace?: string;
}

/**
 * Authentication configuration exposed to frontend
 */
export interface AuthConfig {
  enabled: boolean;
}

/**
 * User information from authenticated token
 */
export interface UserInfo {
  username: string;
  groups?: string[];
}

export interface Settings {
  config: AppConfig;
  providers: ProviderInfo[];
  auth: AuthConfig;
}

/**
 * Runtime status for the runtimes endpoint
 * Used to show installation and health status of each runtime
 */
export interface RuntimeStatus {
  id: string;           // 'dynamo' | 'kuberay'
  name: string;         // Display name
  installed: boolean;   // Underlying runtime (CRD + operator) is ready to use
  healthy: boolean;     // Underlying runtime service is running
  crdFound?: boolean;   // Underlying provider API is available
  operatorRunning?: boolean; // Underlying runtime service pods are ready
  requiresCRD?: boolean; // Whether the provider depends on an upstream runtime operator/CRD
  version?: string;     // Detected version
  message?: string;     // Status message
  /**
   * shimRegistered: true when the AI Runway provider integration ("shim")
   * has registered an InferenceProviderConfig in the cluster. This is true
   * for any runtime that appears in this list; included explicitly so the
   * UI can distinguish the integration's presence from the underlying
   * runtime's installation state.
   */
  shimRegistered?: boolean;
  /**
   * shimConnected: true when the AI Runway provider integration is
   * actively heartbeating (status.ready=true AND a recent lastHeartbeat).
   * Distinct from {@link installed}, which reflects the underlying runtime.
   */
  shimConnected?: boolean;
  /** ISO timestamp of the last shim heartbeat, if reported. */
  shimLastHeartbeat?: string;
}

/**
 * Response for GET /api/runtimes/status
 */
export interface RuntimesStatusResponse {
  runtimes: RuntimeStatus[];
}
