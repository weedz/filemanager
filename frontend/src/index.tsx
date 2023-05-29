import { render, h } from 'preact';
import FileManager from './main';

const App = () => {
    return (
        <div>
            <h1>Hello, world!</h1>
            <FileManager />
        </div>
    );
};

render(<App />, document.body);
