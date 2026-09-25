import { z } from 'zod'

const httpUrlSchema = z.url({ protocol: /^https?$/ })

export { httpUrlSchema }
