export default function Card({ children, ...props }: any) {
  return (
    <div className="border rounded-lg p-4 shadow-sm" {...props}>
      {children}
    </div>
  )
}
