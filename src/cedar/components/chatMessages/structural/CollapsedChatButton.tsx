import React, {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from 'react';
import { useCedarStore, useStyling } from 'cedar-os';
import Container3DButton from '@/cedar/components/containers/Container3DButton';
import { GripVertical, MessageCircle } from 'lucide-react';
import InsetGlow from '@/cedar/components/ornaments/InsetGlow';

/**
 * Shared collapsed trigger button for Cedar chat UIs.
 */
interface CollapsedChatButtonProps {
	/** Which side of the screen the button sits on */
	side?: 'left' | 'right';
	/** Text (question suggestion) to display */
	label: string;
	/** Callback when the button is clicked */
	onClick?: () => void;
	/** Layout id forwarded to the underlying motion component for shared-layout animations */
	layoutId?: string;
	/** Whether the button is placed via CSS `position: fixed` or `absolute`. Default is `fixed` so it works out-of-box */
	position?: 'fixed' | 'absolute';
}

export const CollapsedButton = forwardRef<
	HTMLDivElement,
	CollapsedChatButtonProps
>(({ side = 'right', label, onClick, layoutId, position = 'fixed' }, ref) => {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const { styling } = useStyling();
	const isDarkMode = styling.darkMode;

	const setShowChat = useCedarStore((state) => state.setShowChat);

	// Starting offset = 8px (bottom-2) for a tighter fit
	const BASE_OFFSET = 20;
	const BASE_SIDE_OFFSET = 16; // 8px from the side edge

	// Retrieve persisted offset (if any)
	const getInitialOffset = () => {
		if (typeof window === 'undefined') return BASE_OFFSET;
		const saved = window.localStorage.getItem('cedarCollapsedBottomOffset');
		if (saved) {
			const parsed = parseInt(saved, 10);
			if (!isNaN(parsed)) return parsed;
		}
		return BASE_OFFSET;
	};

	const [bottomOffset, setBottomOffset] = useState<number>(() =>
		getInitialOffset()
	);

	// Drag handling refs/state
	const [isDragging, setIsDragging] = useState(false);

	// Drag start positions
	const dragStartY = useRef(0);
	const dragStartX = useRef(0);

	// Offsets at drag start
	const dragStartBottomOffset = useRef(0);
	const dragStartSideOffset = useRef(0);

	// Horizontal offset (distance from corresponding side)
	const getInitialSideOffset = () => {
		if (typeof window === 'undefined') return BASE_SIDE_OFFSET;
		const key =
			side === 'left'
				? 'cedarCollapsedLeftOffset'
				: 'cedarCollapsedRightOffset';
		const saved = window.localStorage.getItem(key);
		if (saved) {
			const parsed = parseInt(saved, 10);
			if (!isNaN(parsed)) return parsed;
		}
		return BASE_SIDE_OFFSET;
	};

	const [sideOffset, setSideOffset] = useState<number>(() =>
		getInitialSideOffset()
	);

	const positionClasses = `${position} bottom-0 ${
		side === 'left' ? 'left-0' : 'right-0'
	}`;

	/* ===== Drag to reposition (vertical) ===== */
	const startDrag = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			e.preventDefault();
			setIsDragging(true);
			dragStartY.current = e.clientY;
			dragStartX.current = e.clientX;
			dragStartBottomOffset.current = bottomOffset;
			dragStartSideOffset.current = sideOffset;

			if (typeof document !== 'undefined') {
				document.body.style.cursor = 'move';
				document.body.style.userSelect = 'none';
				document.body.style.setProperty('-webkit-user-select', 'none');
			}
		},
		[bottomOffset, sideOffset, side]
	);

	const handleMouseMove = useCallback(
		(e: MouseEvent) => {
			if (!isDragging) return;
			const deltaY = dragStartY.current - e.clientY; // positive when dragging up
			const newBottomOffset = Math.max(
				0,
				dragStartBottomOffset.current + deltaY
			);
			setBottomOffset(newBottomOffset);

			// Horizontal movement
			const deltaX = e.clientX - dragStartX.current;
			if (side === 'left') {
				const newLeftOffset = Math.max(
					BASE_SIDE_OFFSET,
					dragStartSideOffset.current + deltaX
				);
				setSideOffset(newLeftOffset);
			} else {
				const newRightOffset = Math.max(
					BASE_SIDE_OFFSET,
					dragStartSideOffset.current - deltaX
				);
				setSideOffset(newRightOffset);
			}
		},
		[isDragging, bottomOffset, sideOffset, side]
	);

	const handleMouseUp = useCallback(() => {
		if (!isDragging) return;
		setIsDragging(false);
		const SNAP_THRESHOLD = 20; // px tolerance to snap back to default
		const nearDefault =
			Math.abs(bottomOffset - BASE_OFFSET) <= SNAP_THRESHOLD &&
			Math.abs(sideOffset - BASE_SIDE_OFFSET) <= SNAP_THRESHOLD;

		if (nearDefault) {
			// Snap back to default
			setBottomOffset(BASE_OFFSET);
			setSideOffset(BASE_SIDE_OFFSET);

			// Clear persisted offsets
			if (typeof window !== 'undefined') {
				window.localStorage.removeItem('cedarCollapsedBottomOffset');
				window.localStorage.removeItem('cedarCollapsedLeftOffset');
				window.localStorage.removeItem('cedarCollapsedRightOffset');
			}
		} else {
			// Persist the new offsets
			if (typeof window !== 'undefined') {
				window.localStorage.setItem(
					'cedarCollapsedBottomOffset',
					bottomOffset.toString()
				);
				const key =
					side === 'left'
						? 'cedarCollapsedLeftOffset'
						: 'cedarCollapsedRightOffset';
				window.localStorage.setItem(key, sideOffset.toString());
			}
		}

		if (typeof document !== 'undefined') {
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			document.body.style.setProperty('-webkit-user-select', '');
		}
	}, [isDragging, bottomOffset, sideOffset, side, BASE_OFFSET]);

	// Bind/unbind document listeners while dragging
	useEffect(() => {
		if (isDragging) {
			if (typeof document !== 'undefined') {
				document.addEventListener('mousemove', handleMouseMove);
				document.addEventListener('mouseup', handleMouseUp);
			}
		}
		return () => {
			if (typeof document !== 'undefined') {
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			}
		};
	}, [isDragging, handleMouseMove, handleMouseUp]);

	// Expose the DOM node to parent via forwarded ref
	useImperativeHandle(ref, () => wrapperRef.current as HTMLDivElement, []);

	return (
		<div
			ref={wrapperRef}
			className={`${positionClasses} group !m-0 cedar-collapsed`}
			data-side={side}
			style={{
				bottom: bottomOffset,
				zIndex: 9999,
				[side === 'left' ? 'left' : 'right']: sideOffset,
			}}
			aria-label='Open Cedar chat (collapsed)'>
			{/* Drag handle – appears on hover */}
			<div
				className={`absolute top-1/2 -translate-y-1/2 ${
					side === 'left' ? 'left-full ml-1' : 'right-full mr-2'
				} opacity-0 group-hover:opacity-100 transition-opacity cursor-move select-none`}
				onMouseDown={startDrag}
				aria-label='Drag to reposition chat trigger'>
				<GripVertical className='w-4 h-4' />
			</div>
			<Container3DButton
				withMotion={true}
				motionProps={{ layoutId }}
				id='cedar-copilot-collapsed-button'
				onClick={() => {
					setShowChat(true);
					onClick?.();
				}}
				className={`${isDarkMode ? 'bg-[#475569]' : ''} overflow-hidden`}>
				<InsetGlow className='mr-2' />
				<span className='truncate flex-1 text-left font-semibold'>{label}</span>
			</Container3DButton>
			{/* A phone: a round button in the corner, clear of the home indicator. A wide pill there covered the home
			    page's ground (its chips and the sun); the home page's chips leave this corner free. */}
			<style>{FAB_CSS}</style>
			<button
				type='button'
				className='cedar-fab'
				aria-label={label}
				style={{ background: isDarkMode ? '#475569' : '#ffffff', color: isDarkMode ? '#f8fafc' : '#334155' }}
				onClick={() => {
					setShowChat(true);
					onClick?.();
				}}>
				<MessageCircle className='w-5 h-5' aria-hidden='true' />
			</button>
		</div>
	);
});

CollapsedButton.displayName = 'CollapsedButton';

// Below 700px (where the home page's sky is a phone's) only the round button shows, wherever the pill was dragged.
const FAB_CSS = `
.cedar-fab{display:none}
@media (max-width:699px){
  .cedar-collapsed{bottom:max(8px,env(safe-area-inset-bottom,0px))!important;right:max(12px,env(safe-area-inset-right,0px))!important}
  .cedar-collapsed[data-side=left]{right:auto!important;left:max(12px,env(safe-area-inset-left,0px))!important}
  .cedar-collapsed>:not(.cedar-fab){display:none!important}
  .cedar-collapsed .cedar-fab{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;border:1px solid rgba(148,163,184,.45);box-shadow:0 8px 24px -8px rgba(0,0,0,.55);cursor:pointer}
}
`;
