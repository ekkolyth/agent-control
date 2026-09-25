import {
  BasicField,
  Button,
  cn,
  FieldGroup,
  FieldLabel,
  Input,
} from '@ekkolyth/ui'
import { Bot, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getLocalSettings } from '../settings'
import { useConnection } from './use-connection'

const stateDot: Record<string, string> = {
  connected: 'bg-primary',
  connecting: 'bg-primary animate-pulse',
  disconnected: 'bg-muted-foreground',
}

function App() {
  const connection = useConnection()
  const [showSettings, setShowSettings] = useState(false)
  const [serverUrl, setServerUrl] = useState('')

  useEffect(() => {
    void getLocalSettings().then((settings) => {
      setServerUrl(settings.serverUrl)
    })
  }, [])

  const paired = connection.status.tabId != null

  return (
    <div className='isolate flex w-80 flex-col'>
      <header className='flex items-center justify-between gap-2 border-b px-4 py-3'>
        <div className='flex items-center gap-2'>
          <Bot className='size-4 shrink-0' />
          <p className='text-sm font-medium'>Agent Control</p>
        </div>
        <Button
          aria-expanded={showSettings}
          aria-label='Settings'
          onClick={() => setShowSettings((open) => !open)}
          size='icon-sm'
          type='button'
          variant='ghost'
        >
          <Settings />
        </Button>
      </header>

      {showSettings ? (
        <div className='p-4'>
          <FieldGroup>
            <BasicField>
              <FieldLabel htmlFor='server-url'>Server URL</FieldLabel>
              <Input
                autoComplete='off'
                id='server-url'
                name='serverUrl'
                onChange={(e) => setServerUrl(e.target.value)}
                spellCheck={false}
                type='text'
                value={serverUrl}
              />
            </BasicField>
          </FieldGroup>
        </div>
      ) : (
        <div className='flex flex-col gap-1 p-4'>
          <div className='flex items-center gap-2'>
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                stateDot[connection.status.state]
              )}
            />
            <p className='text-sm font-medium capitalize'>
              {connection.status.state}
            </p>
          </div>
          {connection.tabTitle ? (
            <p className='truncate text-sm text-muted-foreground'>
              {connection.tabTitle}
            </p>
          ) : null}
        </div>
      )}

      <footer className='border-t p-3'>
        <Button
          className='w-full'
          onClick={() =>
            void (paired
              ? connection.disconnect()
              : connection.connect(serverUrl))
          }
          type='button'
          variant={paired ? 'secondary' : 'default'}
        >
          {paired ? 'Disconnect' : 'Connect'}
        </Button>
      </footer>
    </div>
  )
}

export { App }
