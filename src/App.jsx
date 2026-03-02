import { useEffect } from 'react'
import ClipsSection from './components/ClipsSection'
import EditorSection from './components/EditorSection'
import { useEditorStore } from './store/editorStore'

export default function App () {
  const cleanupStore = useEditorStore((state) => state.cleanupStore)

  useEffect(() => {
    return () => {
      cleanupStore()
    }
  }, [cleanupStore])

  return (
    <main className='app-shell'>
      <EditorSection />
      <ClipsSection />
    </main>
  )
}
