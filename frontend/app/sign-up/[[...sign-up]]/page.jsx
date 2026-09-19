import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0', background: '#faf9f7', minHeight: '100vh' }}>
      <SignUp />
    </div>
  )
}
