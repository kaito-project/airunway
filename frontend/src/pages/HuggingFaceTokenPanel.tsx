import { CheckCircle, Key, Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type HuggingFaceUser = {
  name: string
  fullname?: string
  avatarUrl?: string
}

interface HuggingFaceTokenPanelProps {
  loading: boolean
  configured?: boolean
  user?: HuggingFaceUser
  connecting: boolean
  disconnecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function HuggingFaceTokenPanel({
  loading,
  configured,
  user,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
}: HuggingFaceTokenPanelProps) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
      <div className="mb-4">
        <h3 className="font-heading text-lg font-semibold flex items-center gap-2">
          <Key className="h-5 w-5" />
          HuggingFace Token
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your HuggingFace account to access gated models like Llama
        </p>
      </div>
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Checking HuggingFace connection...</span>
          </div>
        ) : configured ? (
          <ConnectedHuggingFaceToken user={user} disconnecting={disconnecting} onDisconnect={onDisconnect} />
        ) : (
          <DisconnectedHuggingFaceToken connecting={connecting} onConnect={onConnect} />
        )}
      </div>
    </div>
  )
}

function ConnectedHuggingFaceToken({
  user,
  disconnecting,
  onDisconnect,
}: {
  user?: HuggingFaceUser
  disconnecting: boolean
  onDisconnect: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="h-10 w-10 rounded-full"
            />
          ) : (
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <Key className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div>
            {user ? (
              <>
                <div className="font-medium">{user.fullname || user.name}</div>
                <div className="text-sm text-muted-foreground">@{user.name}</div>
              </>
            ) : (
              <>
                <div className="font-medium">HuggingFace Token</div>
                <div className="text-sm text-muted-foreground">Token configured</div>
              </>
            )}
          </div>
        </div>
        <Badge variant="success">
          <CheckCircle className="h-3 w-3 mr-1" />
          Connected
        </Badge>
      </div>

      <div className="rounded-lg bg-green-50 dark:bg-green-950 p-3 text-sm text-green-800 dark:text-green-200">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          <span>Token saved successfully</span>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onDisconnect}
        disabled={disconnecting}
      >
        {disconnecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Disconnecting...
          </>
        ) : (
          'Disconnect HuggingFace'
        )}
      </Button>
    </div>
  )
}

function DisconnectedHuggingFaceToken({
  connecting,
  onConnect,
}: {
  connecting: boolean
  onConnect: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Sign in with HuggingFace to automatically configure your token for accessing gated models.
        The token will be securely stored.
      </div>

      <Button
        onClick={onConnect}
        disabled={connecting}
        className="bg-[#FFD21E] hover:bg-[#FFD21E]/90 text-black"
      >
        {connecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Redirecting...
          </>
        ) : (
          <>
            <span aria-hidden="true" className="mr-2 text-base leading-none">🤗</span>
            Sign in with Hugging Face
          </>
        )}
      </Button>
    </div>
  )
}
