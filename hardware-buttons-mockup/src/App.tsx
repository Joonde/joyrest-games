import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Bluetooth,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Gamepad2,
  ListOrdered,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Unlink,
  Usb,
  Wifi,
  X,
} from 'lucide-react'
import './App.css'

type Source = 'bluetooth' | 'usb'
type View = 'setup' | 'test' | 'game'
type PressSource = Source | 'phone'

type Team = {
  id: string
  name: string
  color: string
}

type Device = {
  id: string
  source: Source
  label: string
  teamId: string | null
  connected: boolean
  battery: number | null
}

type QueueItem = {
  teamId: string
  source: PressSource
}

type WizardState = {
  index: number
  completed: boolean
  deviceId: string | null
}

type TransferState = {
  deviceId: string
  teamId: string
}

const teams: Team[] = [
  { id: 'bears', name: 'Медведи', color: '#E3AA9C' },
  { id: 'hares', name: 'Зайцы', color: '#E3C68C' },
  { id: 'cosmonauts', name: 'Космонавты', color: '#A3C2AA' },
  { id: 'north', name: 'Север', color: '#D2A0AC' },
  { id: 'lions', name: 'Львы', color: '#B3AADD' },
  { id: 'barca', name: 'Барсы', color: '#E3AA9C' },
]

const initialDevices: Device[] = [
  { id: 'bt-1', source: 'bluetooth', label: 'Кнопка 1', teamId: 'bears', connected: true, battery: 84 },
  { id: 'usb-1', source: 'usb', label: 'USB №1', teamId: 'hares', connected: true, battery: null },
  { id: 'bt-2', source: 'bluetooth', label: 'Кнопка 2', teamId: 'cosmonauts', connected: true, battery: 67 },
  { id: 'usb-2', source: 'usb', label: 'USB №2', teamId: 'north', connected: true, battery: null },
  { id: 'bt-3', source: 'bluetooth', label: 'Кнопка 3', teamId: 'lions', connected: false, battery: 21 },
  { id: 'usb-3', source: 'usb', label: 'USB №3', teamId: null, connected: true, battery: null },
]

const sourceName = (source: PressSource) => {
  if (source === 'bluetooth') return 'Bluetooth'
  if (source === 'usb') return 'USB'
  return 'Телефон'
}

function loadDevices(): Device[] {
  try {
    const saved = localStorage.getItem('joyrest-hardware-mockup-v1')
    if (!saved) return initialDevices
    const parsed = JSON.parse(saved) as Device[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : initialDevices
  } catch {
    return initialDevices
  }
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal__head">
          <h2 id="modal-title">{title}</h2>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Закрыть окно">
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

function SourceIcon({ source, size = 18 }: { source: PressSource; size?: number }) {
  if (source === 'bluetooth') return <Bluetooth size={size} aria-hidden="true" />
  if (source === 'usb') return <Usb size={size} aria-hidden="true" />
  return <Smartphone size={size} aria-hidden="true" />
}

function PhysicalButton({ source, label, onClick, disabled = false, compact = false }: { source: Source; label: string; onClick: () => void; disabled?: boolean; compact?: boolean }) {
  return (
    <button type="button" className={`physical-button ${compact ? 'physical-button--compact' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="physical-button__source"><SourceIcon source={source} size={16} />{sourceName(source)}</span>
      <span className="physical-button__body" aria-hidden="true"><span /></span>
      <span className="physical-button__label">{label}</span>
    </button>
  )
}

export default function App() {
  const [view, setView] = useState<View>('setup')
  const [devices, setDevices] = useState<Device[]>(loadDevices)
  const [toast, setToast] = useState('')
  const [addSource, setAddSource] = useState<Source | null>(null)
  const [wizard, setWizard] = useState<WizardState | null>(null)
  const [manualTeamId, setManualTeamId] = useState<string | null>(null)
  const [transfer, setTransfer] = useState<TransferState | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [tested, setTested] = useState<string[]>([])
  const [questionOpen, setQuestionOpen] = useState(false)
  const [questionNumber, setQuestionNumber] = useState(1)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [out, setOut] = useState<string[]>([])
  const [winner, setWinner] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    localStorage.setItem('joyrest-hardware-mockup-v1', JSON.stringify(devices))
  }, [devices])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const notify = (message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3600)
  }

  const assigned = devices.filter((device) => device.teamId)
  const assignedOnline = assigned.filter((device) => device.connected)
  const bluetoothCount = devices.filter((device) => device.source === 'bluetooth').length
  const usbCount = devices.filter((device) => device.source === 'usb').length
  const currentSpeaker = queue.find((item) => !out.includes(item.teamId)) ?? null

  const teamById = (id: string | null) => teams.find((team) => team.id === id)
  const deviceForTeam = (teamId: string) => devices.find((device) => device.teamId === teamId)

  const createDevice = (source: Source): Device => {
    const count = devices.filter((device) => device.source === source).length + 1
    return {
      id: `${source}-${Date.now()}`,
      source,
      label: source === 'usb' ? `USB №${count}` : `Кнопка ${count}`,
      teamId: null,
      connected: true,
      battery: source === 'bluetooth' ? 100 : null,
    }
  }

  const addDevice = (source: Source) => {
    const device = createDevice(source)
    setDevices((current) => [...current, device])
    setAddSource(null)
    notify(`${device.label} обнаружена. Теперь назначьте её команде.`)
  }

  const assign = (deviceId: string, teamId: string) => {
    setDevices((current) => current.map((device) => {
      if (device.teamId === teamId && device.id !== deviceId) return { ...device, teamId: null }
      if (device.id === deviceId) return { ...device, teamId }
      return device
    }))
  }

  const openWizard = () => {
    const firstEmpty = teams.findIndex((team) => !deviceForTeam(team.id))
    setWizard({ index: firstEmpty >= 0 ? firstEmpty : 0, completed: false, deviceId: null })
  }

  const wizardPress = (source: Source) => {
    if (!wizard) return
    const team = teams[wizard.index]
    let device = devices.find((item) => item.source === source && item.connected && !item.teamId)
    if (!device) {
      device = createDevice(source)
      setDevices((current) => [...current, device!])
    }
    assign(device.id, team.id)
    setWizard({ ...wizard, completed: true, deviceId: device.id })
  }

  const nextWizard = () => {
    if (!wizard) return
    if (wizard.index >= teams.length - 1) {
      setWizard(null)
      notify('Назначение завершено. Можно перейти к проверке.')
      return
    }
    setWizard({ index: wizard.index + 1, completed: false, deviceId: null })
  }

  const chooseManualDevice = (device: Device) => {
    if (!manualTeamId) return
    if (device.teamId && device.teamId !== manualTeamId) {
      setTransfer({ deviceId: device.id, teamId: manualTeamId })
      setManualTeamId(null)
      return
    }
    assign(device.id, manualTeamId)
    notify(`${device.label} назначена команде «${teamById(manualTeamId)?.name}».`)
    setManualTeamId(null)
  }

  const confirmTransfer = () => {
    if (!transfer) return
    assign(transfer.deviceId, transfer.teamId)
    const device = devices.find((item) => item.id === transfer.deviceId)
    notify(`${device?.label ?? 'Кнопка'} переназначена команде «${teamById(transfer.teamId)?.name}».`)
    setTransfer(null)
  }

  const testPress = (device: Device) => {
    if (!device.teamId || !device.connected) return
    if (!tested.includes(device.teamId)) setTested((current) => [...current, device.teamId!])
    notify(`${teamById(device.teamId)?.name}: нажатие получено. Ответы и очки не изменены.`)
  }

  const registerPress = (teamId: string, source: PressSource) => {
    const team = teamById(teamId)
    if (!questionOpen || winner) {
      notify(`Раннее нажатие команды «${team?.name}» не засчитано.`)
      return
    }
    if (out.includes(teamId)) {
      notify(`Команда «${team?.name}» уже ответила неверно на этом вопросе.`)
      return
    }
    if (queue.some((item) => item.teamId === teamId)) {
      notify(`Повторное нажатие команды «${team?.name}» не меняет очередь.`)
      return
    }
    setQueue((current) => [...current, { teamId, source }])
    notify(`${team?.name}: нажатие принято через ${sourceName(source)}.`)
  }

  const gamePress = (device: Device) => {
    if (!device.connected) return
    if (!device.teamId) {
      notify(`Неизвестная кнопка ${device.label}: назначьте её команде.`)
      return
    }
    registerPress(device.teamId, device.source)
  }

  const answerRight = () => {
    if (!currentSpeaker) return
    setWinner(currentSpeaker.teamId)
    setQuestionOpen(false)
    notify(`Верно: очки команды «${teamById(currentSpeaker.teamId)?.name}».`)
  }

  const answerWrong = () => {
    if (!currentSpeaker) return
    const teamId = currentSpeaker.teamId
    setOut((current) => [...current, teamId])
    const next = queue.find((item) => item.teamId !== teamId && !out.includes(item.teamId))
    notify(next ? `Неверно. Слово переходит команде «${teamById(next.teamId)?.name}».` : 'Неверно. Очередь закончилась — кнопки снова открыты.')
  }

  const nextQuestion = () => {
    setQuestionNumber((current) => current + 1)
    setQuestionOpen(false)
    setQueue([])
    setOut([])
    setWinner(null)
  }

  const resetDemo = () => {
    setDevices(initialDevices)
    setTested([])
    setQuestionOpen(false)
    setQuestionNumber(1)
    setQueue([])
    setOut([])
    setWinner(null)
    setView('setup')
    setConfirmReset(false)
    localStorage.removeItem('joyrest-hardware-mockup-v1')
    notify('Макет возвращён к исходному сценарию.')
  }

  const changeView = (next: View) => {
    setView(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__inner">
          <button type="button" className="brand" onClick={() => changeView('setup')} aria-label="JoyRest — к настройке кнопок">
            <span className="brand__mark">JR</span>
            <span><strong>JoyRest</strong><small>физические кнопки</small></span>
          </button>
          <div className="topbar__game">
            <span className="live-dot" />
            <span>Вечер в кино</span>
            <span className="topbar__divider" />
            <span>Ставка на знания</span>
          </div>
          <button type="button" className="button button--quiet topbar__reset" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={17} />Сбросить макет
          </button>
        </div>
      </header>

      <main className="workspace">
        <div className="demo-note"><CircleHelp size={17} /><span>Интерактивный макет: нажатия виртуальные, оборудование и сервер не подключены.</span></div>

        <section className="page-heading">
          <div>
            <p className="overline">Пульт ведущего</p>
            <h1>{view === 'setup' ? 'Физические кнопки' : view === 'test' ? 'Проверка перед игрой' : 'Игровой режим'}</h1>
            <p>{view === 'setup' ? 'Подключите Bluetooth-кнопки или USB-приёмник и свяжите каждую кнопку с командой.' : view === 'test' ? 'Нажмите все кнопки и убедитесь, что каждая связана с нужной командой. Ответы и очки не меняются.' : 'Физические кнопки и телефоны работают в одной очереди. Порядок определяет сервер.'}</p>
          </div>
          {view === 'setup' && (
            <button type="button" className="button button--primary button--large" onClick={openWizard}>
              <ListOrdered size={20} />Назначить по очереди
            </button>
          )}
          {view === 'test' && (
            <button type="button" className="button button--primary button--large" onClick={() => changeView('game')}>
              <Play size={20} />Перейти к игре
            </button>
          )}
          {view === 'game' && (
            <button type="button" className={`button button--large ${questionOpen ? 'button--secondary' : 'button--primary'}`} onClick={() => setQuestionOpen((current) => !current)} disabled={Boolean(winner)}>
              <Radio size={20} />{questionOpen ? 'Закрыть приём' : 'Запустить отсчёт'}
            </button>
          )}
        </section>

        <nav className="workflow-nav" aria-label="Этапы работы с кнопками">
          <button type="button" className={view === 'setup' ? 'is-active' : ''} onClick={() => changeView('setup')}><span>1</span>Настройка</button>
          <ChevronRight size={17} aria-hidden="true" />
          <button type="button" className={view === 'test' ? 'is-active' : ''} onClick={() => changeView('test')}><span>2</span>Проверка{tested.length > 0 && <b>{tested.length}</b>}</button>
          <ChevronRight size={17} aria-hidden="true" />
          <button type="button" className={view === 'game' ? 'is-active' : ''} onClick={() => changeView('game')}><span>3</span>Игра</button>
        </nav>

        {view === 'setup' && (
          <>
            <section className="connection-strip" aria-label="Состояние оборудования">
              <div className="connection-strip__app">
                <span className="status-icon status-icon--success"><Wifi size={20} /></span>
                <div><strong>JoyRest Кнопки запущена</strong><span>Связь с пультом установлена на этом компьютере</span></div>
              </div>
              <button type="button" className="source-tile" onClick={() => setAddSource('bluetooth')}>
                <Bluetooth size={22} /><span><strong>Bluetooth</strong><small>{bluetoothCount} устройства · добавить</small></span><Plus size={18} />
              </button>
              <button type="button" className="source-tile" onClick={() => setAddSource('usb')}>
                <Usb size={22} /><span><strong>USB-приёмник</strong><small>{usbCount} кнопки · добавить</small></span><Plus size={18} />
              </button>
            </section>

            <section className="summary-row" aria-label="Сводка назначения">
              <div><span>Назначено</span><strong>{assigned.length}<small> / {teams.length}</small></strong></div>
              <div><span>На связи</span><strong>{assignedOnline.length}<small> / {assigned.length}</small></strong></div>
              <div><span>Свободные кнопки</span><strong>{devices.filter((device) => !device.teamId).length}</strong></div>
              <div className="summary-row__ready"><ShieldCheck size={22} /><span><strong>{assigned.length === teams.length && assignedOnline.length === assigned.length ? 'Всё готово' : 'Нужна настройка'}</strong><small>{assigned.length === teams.length ? 'Все команды получили кнопки' : `Осталось назначить: ${teams.length - assigned.length}`}</small></span></div>
            </section>

            <section className="panel">
              <div className="panel__head">
                <div><h2>Команды и кнопки</h2><p>Одна активная кнопка на команду. Привязка сохранится после обновления страницы.</p></div>
                <button type="button" className="button button--secondary" onClick={() => changeView('test')} disabled={assigned.length === 0}><Gamepad2 size={18} />Проверить кнопки</button>
              </div>
              <div className="team-table" role="table" aria-label="Привязка кнопок к командам">
                <div className="team-table__header" role="row"><span>Команда</span><span>Кнопка</span><span>Состояние</span><span>Действия</span></div>
                {teams.map((team, index) => {
                  const device = deviceForTeam(team.id)
                  return (
                    <div className="team-row" role="row" key={team.id}>
                      <div className="team-cell" data-label="Команда"><span className="team-color" style={{ background: team.color }} /><span><strong>{team.name}</strong><small>Команда {index + 1}</small></span></div>
                      <div className="device-cell" data-label="Кнопка">
                        {device ? <><SourceIcon source={device.source} /><span><strong>{device.label}</strong><small>{sourceName(device.source)}{device.battery !== null ? ` · заряд ${device.battery}%` : ' · через приёмник'}</small></span></> : <span className="empty-assignment">Не назначена</span>}
                      </div>
                      <div data-label="Состояние">
                        {device ? <span className={`status-badge ${device.connected ? 'status-badge--online' : 'status-badge--offline'}`}><span />{device.connected ? 'На связи' : 'Нет связи'}</span> : <span className="status-badge status-badge--empty"><span />Ожидает</span>}
                      </div>
                      <div className="row-actions" data-label="Действия">
                        <button type="button" className="button button--small button--secondary" onClick={() => setManualTeamId(team.id)}><Pencil size={16} />{device ? 'Изменить' : 'Назначить'}</button>
                        {device && !device.connected && <button type="button" className="button button--small button--primary" onClick={() => { setDevices((current) => current.map((item) => item.id === device.id ? { ...item, connected: true } : item)); notify(`${device.label} снова на связи.`) }}><Wifi size={16} />Подключить</button>}
                        {device && <button type="button" className="icon-button" title="Отвязать кнопку" aria-label={`Отвязать кнопку от команды ${team.name}`} onClick={() => { assign(device.id, team.id); setDevices((current) => current.map((item) => item.id === device.id ? { ...item, teamId: null } : item)); notify(`${device.label} отвязана от команды «${team.name}».`) }}><Unlink size={17} /></button>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="hint-panel">
              <ShieldCheck size={22} />
              <div><strong>Привязка к команде, не к телефону капитана</strong><p>Смена капитана или перезаход с другого телефона не влияют на физическую кнопку. Команда без телефона тоже может играть.</p></div>
            </section>
          </>
        )}

        {view === 'test' && (
          <div className="test-layout">
            <section className="panel">
              <div className="panel__head"><div><h2>Проверка команд</h2><p>Получено нажатий: {tested.length} из {assigned.length}</p></div><button type="button" className="button button--secondary button--small" onClick={() => setTested([])} disabled={tested.length === 0}><RotateCcw size={16} />Начать заново</button></div>
              <div className="test-progress"><span style={{ width: `${assigned.length ? tested.length / assigned.length * 100 : 0}%` }} /></div>
              <div className="test-teams">
                {teams.map((team) => {
                  const device = deviceForTeam(team.id)
                  const passed = tested.includes(team.id)
                  return <div className={`test-team ${passed ? 'is-passed' : ''}`} key={team.id}>
                    <span className="test-team__mark" style={{ borderColor: team.color }}>{passed ? <Check size={21} /> : <span style={{ background: team.color }} />}</span>
                    <div><strong>{team.name}</strong><small>{!device ? 'Кнопка не назначена' : !device.connected ? 'Нет связи' : passed ? 'Нажатие получено' : 'Ожидает нажатия'}</small></div>
                    {passed && <CheckCircle2 size={20} className="success-icon" />}
                  </div>
                })}
              </div>
            </section>
            <section className="panel virtual-panel">
              <div className="panel__head"><div><p className="overline">Симулятор оборудования</p><h2>Нажмите кнопки</h2><p>Каждое нажатие ниже имитирует сигнал от реального устройства.</p></div></div>
              <div className="device-press-grid">
                {assigned.map((device) => <PhysicalButton key={device.id} source={device.source} label={`${device.label} · ${teamById(device.teamId)?.name}`} onClick={() => testPress(device)} disabled={!device.connected} compact />)}
              </div>
              {assigned.length === 0 && <p className="empty-state">Сначала назначьте хотя бы одну кнопку команде.</p>}
              {!assigned.every((device) => device.connected) && <p className="inline-warning">Отключённые кнопки недоступны. Вернитесь в настройку и переподключите их.</p>}
            </section>
          </div>
        )}

        {view === 'game' && (
          <>
            <section className={`question-banner ${questionOpen ? 'is-open' : ''} ${winner ? 'is-finished' : ''}`}>
              <div><span className="question-banner__number">Вопрос {questionNumber}</span><h2>{winner ? `Верно ответила команда «${teamById(winner)?.name}»` : questionOpen ? 'Кнопки открыты — жмите!' : 'Кто первым назовёт фильм по кадру?'}</h2><p>{winner ? 'Вопрос завершён. Можно переходить к следующему.' : questionOpen ? 'Сервер принимает первое нажатие от каждой команды.' : 'Прочитайте вопрос вслух, затем запустите отсчёт. Ранние нажатия не засчитываются.'}</p></div>
              <span className={`question-state ${questionOpen ? 'question-state--open' : ''}`}><span />{winner ? 'Ответ принят' : questionOpen ? 'Приём открыт' : 'Слушаем вопрос'}</span>
            </section>

            <div className="game-layout">
              <section className="panel queue-panel">
                <div className="panel__head"><div><p className="overline">Пульт ведущего</p><h2>Очередь нажатий</h2></div><span className="connection-counter"><span />{assignedOnline.length} на связи</span></div>
                {queue.length === 0 ? <div className="queue-empty"><ListOrdered size={30} /><strong>Нажатий пока нет</strong><p>{questionOpen ? 'Очередь появится после первого нажатия.' : 'Сначала запустите отсчёт.'}</p></div> : (
                  <ol className="queue-list">
                    {queue.map((item, index) => {
                      const team = teamById(item.teamId)!
                      const isOut = out.includes(item.teamId)
                      const isCurrent = currentSpeaker?.teamId === item.teamId && !winner
                      const isWinner = winner === item.teamId
                      return <li key={item.teamId} className={`${isCurrent ? 'is-current' : ''} ${isOut ? 'is-out' : ''} ${isWinner ? 'is-winner' : ''}`}>
                        <span className="queue-list__number">{index + 1}</span><span className="team-color" style={{ background: team.color }} /><div><strong>{team.name}</strong><small><SourceIcon source={item.source} size={14} />{sourceName(item.source)}</small></div><span className="queue-list__state">{isWinner ? 'Верно' : isOut ? 'Мимо' : isCurrent ? 'Отвечает' : 'Ожидает'}</span>
                      </li>
                    })}
                  </ol>
                )}
                <div className="answer-actions">
                  <button type="button" className="button button--success" onClick={answerRight} disabled={!currentSpeaker || !questionOpen}><Check size={19} />Верно</button>
                  <button type="button" className="button button--danger" onClick={answerWrong} disabled={!currentSpeaker || !questionOpen}><X size={19} />Неверно</button>
                </div>
                <button type="button" className="button button--secondary button--block" onClick={nextQuestion}><ArrowRight size={18} />Следующий вопрос</button>
              </section>

              <section className="panel virtual-panel">
                <div className="panel__head"><div><p className="overline">Симулятор оборудования</p><h2>Физические кнопки</h2><p>Нажимайте до и после запуска отсчёта, повторно и с разных источников.</p></div></div>
                <div className="device-press-grid">
                  {devices.map((device) => <PhysicalButton key={device.id} source={device.source} label={`${device.label}${device.teamId ? ` · ${teamById(device.teamId)?.name}` : ' · не назначена'}`} onClick={() => gamePress(device)} disabled={!device.connected} compact />)}
                </div>
                <div className="phone-fallback">
                  <div><Smartphone size={20} /><span><strong>Резерв через телефон</strong><small>Для команды, у которой кнопка потеряла связь</small></span></div>
                  {teams.filter((team) => deviceForTeam(team.id) && !deviceForTeam(team.id)?.connected).map((team) => <button type="button" className="button button--secondary button--small" key={team.id} onClick={() => registerPress(team.id, 'phone')}><Smartphone size={16} />{team.name}</button>)}
                  {teams.every((team) => !deviceForTeam(team.id) || deviceForTeam(team.id)?.connected) && <p>Все назначенные кнопки на связи — резерв не нужен.</p>}
                </div>
              </section>
            </div>
          </>
        )}

        <footer><span>JoyRest · концепт физических кнопок</span><span>Состояние макета хранится только в этом браузере</span></footer>
      </main>

      {addSource && (
        <Modal title={addSource === 'bluetooth' ? 'Добавить Bluetooth-кнопку' : 'Добавить кнопку USB-комплекта'} onClose={() => setAddSource(null)}>
          <div className="connection-illustration"><span><SourceIcon source={addSource} size={32} /></span><div><i /><i /><i /></div><span><Plus size={30} /></span></div>
          <ol className="instruction-list">
            {addSource === 'bluetooth' ? <><li><span>1</span>Переведите кнопку в режим сопряжения по инструкции производителя.</li><li><span>2</span>Дождитесь обнаружения в программе JoyRest Кнопки.</li><li><span>3</span>Нажмите кнопку, чтобы подтвердить нужное устройство.</li></> : <><li><span>1</span>Подключите USB-приёмник к компьютеру ведущего.</li><li><span>2</span>Включите кнопку из комплекта.</li><li><span>3</span>Нажмите её — JoyRest определит номер внутри комплекта.</li></>}
          </ol>
          <div className="modal__actions"><button type="button" className="button button--quiet" onClick={() => setAddSource(null)}>Отмена</button><button type="button" className="button button--primary" onClick={() => addDevice(addSource)}><Plus size={18} />Имитировать обнаружение</button></div>
        </Modal>
      )}

      {wizard && (
        <Modal title="Назначение по очереди" onClose={() => setWizard(null)} wide>
          <div className="wizard-progress"><span>Команда {wizard.index + 1} из {teams.length}</span><div>{teams.map((team, index) => <i key={team.id} className={index < wizard.index || (index === wizard.index && wizard.completed) ? 'is-done' : index === wizard.index ? 'is-current' : ''} />)}</div></div>
          <div className="wizard-team"><span className="team-color" style={{ background: teams[wizard.index].color }} /><p>{wizard.completed ? 'Кнопка назначена' : 'Сейчас назначаем'}</p><h3>{teams[wizard.index].name}</h3><span>{wizard.completed ? `${devices.find((device) => device.id === wizard.deviceId)?.label} закреплена за командой` : 'Попросите команду нажать свою физическую кнопку'}</span></div>
          {!wizard.completed ? <>
            <p className="simulator-caption">В макете выберите, какая кнопка нажата:</p>
            <div className="wizard-buttons"><PhysicalButton source="bluetooth" label="Нажать Bluetooth" onClick={() => wizardPress('bluetooth')} /><PhysicalButton source="usb" label="Нажать USB" onClick={() => wizardPress('usb')} /></div>
          </> : <div className="assignment-success"><CheckCircle2 size={24} /><span>Назначение сохранено. В игре нажатие этой кнопки попадёт в общую очередь.</span></div>}
          <div className="modal__actions modal__actions--spread"><button type="button" className="button button--quiet" onClick={() => setWizard(null)}>Закончить</button><div>{!wizard.completed && <button type="button" className="button button--secondary" onClick={nextWizard}>Пропустить</button>}{wizard.completed && <button type="button" className="button button--primary" onClick={nextWizard}>{wizard.index === teams.length - 1 ? 'Завершить назначение' : 'Следующая команда'}<ArrowRight size={18} /></button>}</div></div>
        </Modal>
      )}

      {manualTeamId && (
        <Modal title={`Кнопка для команды «${teamById(manualTeamId)?.name}»`} onClose={() => setManualTeamId(null)} wide>
          <p className="modal-intro">Нажмите новую виртуальную кнопку или выберите уже обнаруженное устройство.</p>
          <div className="wizard-buttons wizard-buttons--small"><PhysicalButton source="bluetooth" label="Новая Bluetooth" onClick={() => { const device = createDevice('bluetooth'); setDevices((current) => [...current, device]); assign(device.id, manualTeamId); setManualTeamId(null); notify(`${device.label} назначена команде.`) }} /><PhysicalButton source="usb" label="Новая USB" onClick={() => { const device = createDevice('usb'); setDevices((current) => [...current, device]); assign(device.id, manualTeamId); setManualTeamId(null); notify(`${device.label} назначена команде.`) }} /></div>
          <div className="device-picker"><h3>Обнаруженные устройства</h3>{devices.map((device) => <button type="button" key={device.id} disabled={!device.connected} onClick={() => chooseManualDevice(device)}><SourceIcon source={device.source} /><span><strong>{device.label}</strong><small>{device.teamId ? `Сейчас: ${teamById(device.teamId)?.name}` : 'Свободная кнопка'}</small></span><span className={`picker-state ${device.connected ? '' : 'is-offline'}`}>{device.connected ? 'На связи' : 'Нет связи'}</span><ChevronRight size={18} /></button>)}</div>
        </Modal>
      )}

      {transfer && (
        <Modal title="Переназначить кнопку?" onClose={() => { setTransfer(null); setManualTeamId(transfer.teamId) }}>
          <p className="modal-intro">«{devices.find((device) => device.id === transfer.deviceId)?.label}» уже назначена команде «{teamById(devices.find((device) => device.id === transfer.deviceId)?.teamId ?? null)?.name}». После переноса прежняя команда останется без физической кнопки.</p>
          <div className="modal__actions"><button type="button" className="button button--quiet" onClick={() => { setTransfer(null); setManualTeamId(transfer.teamId) }}>Отмена</button><button type="button" className="button button--primary" onClick={confirmTransfer}>Переназначить команде «{teamById(transfer.teamId)?.name}»</button></div>
        </Modal>
      )}

      {confirmReset && (
        <Modal title="Сбросить макет?" onClose={() => setConfirmReset(false)}>
          <p className="modal-intro">Все изменения привязок, проверка и игровая очередь вернутся к исходному демонстрационному состоянию.</p>
          <div className="modal__actions"><button type="button" className="button button--quiet" onClick={() => setConfirmReset(false)}>Отмена</button><button type="button" className="button button--danger" onClick={resetDemo}><RotateCcw size={18} />Сбросить</button></div>
        </Modal>
      )}

      {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Закрыть уведомление"><X size={17} /></button></div>}
    </div>
  )
}
