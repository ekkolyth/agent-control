import { z } from 'zod'
import { httpUrlSchema } from './url'

const MAX_WAIT_SECONDS = 30

const ELEMENT_DESCRIPTION =
  'Human-readable element description used to obtain permission to interact with the element'
const REF_DESCRIPTION = 'Exact target element reference from the page snapshot'
const URL_DESCRIPTION = 'The URL to navigate to'
const TIME_DESCRIPTION = 'The time to wait in seconds'
const KEY_DESCRIPTION =
  'Name of the key to press or a character to generate, such as `ArrowLeft` or `a`'
const START_ELEMENT_DESCRIPTION =
  'Human-readable source element description used to obtain the permission to interact with the element'
const START_REF_DESCRIPTION =
  'Exact source element reference from the page snapshot'
const END_ELEMENT_DESCRIPTION =
  'Human-readable target element description used to obtain the permission to interact with the element'
const TEXT_DESCRIPTION = 'Text to type into the element'
const SUBMIT_DESCRIPTION = 'Whether to submit entered text (press Enter after)'
const FILENAME_DESCRIPTION =
  'Absolute or ~/ path to also save the PNG to. Only pass this when the user asked for the screenshot to be saved; if they gave no path, use `.screenshots/<name>.png` at the root of the repository you are working in, and make sure `.screenshots` is gitignored there.'
const VALUES_DESCRIPTION =
  'Array of values to select in the dropdown. This can be a single value or multiple values.'

type ToolName =
  | 'browser_navigate'
  | 'browser_go_back'
  | 'browser_go_forward'
  | 'browser_snapshot'
  | 'browser_click'
  | 'browser_hover'
  | 'browser_type'
  | 'browser_press_key'
  | 'browser_select_option'
  | 'browser_drag'
  | 'browser_screenshot'
  | 'browser_get_console_logs'
  | 'browser_wait'

type ToolDefinition = {
  name: ToolName
  description: string
  inputShape: z.ZodRawShape
}

const toolDefinitions = [
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL',
    inputShape: {
      url: httpUrlSchema.describe(URL_DESCRIPTION),
    },
  },
  {
    name: 'browser_go_back',
    description: 'Go back to the previous page',
    inputShape: {},
  },
  {
    name: 'browser_go_forward',
    description: 'Go forward to the next page',
    inputShape: {},
  },
  {
    name: 'browser_snapshot',
    description:
      'Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with.',
    inputShape: {},
  },
  {
    name: 'browser_click',
    description: 'Perform click on a web page',
    inputShape: {
      element: z.string().describe(ELEMENT_DESCRIPTION),
      ref: z.string().min(1).describe(REF_DESCRIPTION),
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over element on page',
    inputShape: {
      element: z.string().describe(ELEMENT_DESCRIPTION),
      ref: z.string().min(1).describe(REF_DESCRIPTION),
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into editable element',
    inputShape: {
      element: z.string().describe(ELEMENT_DESCRIPTION),
      ref: z.string().min(1).describe(REF_DESCRIPTION),
      text: z.string().describe(TEXT_DESCRIPTION),
      submit: z.boolean().describe(SUBMIT_DESCRIPTION),
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a key on the keyboard',
    inputShape: { key: z.string().min(1).describe(KEY_DESCRIPTION) },
  },
  {
    name: 'browser_select_option',
    description: 'Select an option in a dropdown',
    inputShape: {
      element: z.string().describe(ELEMENT_DESCRIPTION),
      ref: z.string().min(1).describe(REF_DESCRIPTION),
      values: z.array(z.string()).min(1).describe(VALUES_DESCRIPTION),
    },
  },
  {
    name: 'browser_drag',
    description: 'Perform drag and drop between two elements',
    inputShape: {
      startElement: z.string().describe(START_ELEMENT_DESCRIPTION),
      startRef: z.string().min(1).describe(START_REF_DESCRIPTION),
      endElement: z.string().describe(END_ELEMENT_DESCRIPTION),
      endRef: z.string().min(1).describe(REF_DESCRIPTION),
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page',
    inputShape: {
      filename: z.string().min(1).optional().describe(FILENAME_DESCRIPTION),
    },
  },
  {
    name: 'browser_get_console_logs',
    description: 'Get the console logs from the browser',
    inputShape: {},
  },
  {
    name: 'browser_wait',
    description: 'Wait for a specified time in seconds',
    inputShape: {
      time: z
        .number()
        .positive()
        .max(MAX_WAIT_SECONDS)
        .describe(TIME_DESCRIPTION),
    },
  },
] as const satisfies readonly ToolDefinition[]

const toolInputSchemas = Object.fromEntries(
  toolDefinitions.map((tool) => [tool.name, z.object(tool.inputShape)])
) as {
  [K in (typeof toolDefinitions)[number] as K['name']]: z.ZodObject<
    K['inputShape']
  >
}

export type { ToolDefinition, ToolName }
export { toolDefinitions, toolInputSchemas }
